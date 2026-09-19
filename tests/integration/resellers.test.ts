import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, withTransaction } from "@/lib/db/client";
import { cancelOrder, dispatchOrder, markOrderDelivered, transitionOrder, type OrderActor } from "@/modules/orders/service";
import { recordCodCollection } from "@/modules/payments/service";
import { importCourierSettlement, reconcileSettlement, resolveSettlementEntry } from "@/modules/settlements/service";
import {
  applyResellerMarkup,
  createReseller,
  createResellerOrder,
  recordCollectionChange,
  setResellerPrice,
  type ResellerActor,
} from "@/modules/resellers/service";
import { resellerInputSchema } from "@/modules/resellers/schemas";
import { recordLedgerAdjustment, refreshResellerEligibility, resellerBalance } from "@/modules/resellers/earnings";
import { approvePayout, createPayout, eligiblePayoutEntries, markPayoutPaid } from "@/modules/resellers/payouts";
import { runReport, resolveRange } from "@/modules/reports/queries";
import { parseAmountToPaisa } from "@/lib/money";
import {
  addTestStock,
  createTestBusiness,
  createTestVariant,
  databaseReachable,
  destroyTestBusiness,
  type TestContext,
} from "./fixtures";

/**
 * Stage 4 — reseller earnings, courier settlements and payouts.
 *
 * The rules under test come from the specification:
 *
 *  - delivery alone does not make money payable: the courier's COD cash has to be
 *    received *and* reconciled against the statement;
 *  - a partially matched statement only unlocks the rows that actually matched;
 *  - a payout can never exceed the payable balance and one ledger entry can never
 *    sit in two payouts;
 *  - a cancelled order reverses its ledger entries instead of deleting them;
 *  - the reports agree with the ledger they are derived from.
 *
 * The suite drives the real services end to end — order creation, dispatch, COD
 * collection, statement import, payout — so breaking any link in the chain fails here.
 * No provider HTTP call is made: `MANUAL` is the own-delivery provider.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("resellers, settlements and payouts (database)", () => {
  let context: TestContext;
  let resellerId: string;
  let resellerCode: string;

  const staff = (): OrderActor => ({ businessId: context.businessId, userId: context.userId, actorType: "USER", actorLabel: "test-staff" });
  const asReseller = (): ResellerActor => ({ businessId: context.businessId, userId: context.userId, actorType: "USER", actorLabel: "test-staff" });
  const asSettlements = () => ({ businessId: context.businessId, userId: context.userId });

  beforeAll(async () => {
    context = await createTestBusiness("stage4");
    // Reseller orders are staff-created and do not need a storefront; the courier
    // provider is the own-delivery one, so no provider credentials are involved.
    await prisma.courierProvider.create({
      data: { businessId: context.businessId, code: "MANUAL", name: "Own delivery", isEnabled: true, priority: 1 },
    });

    const created = await createReseller(
      asReseller(),
      resellerInputSchema.parse({
        name: "Rahman Traders",
        phone: "01711000001",
        address: "Station Road, Ishwardi",
        packagingIncluded: false,
        packagingCostPaisa: 1_000,
        defaultDistrictCode: "26",
        minimumPayoutPaisa: 0,
      }),
    );
    resellerId = created.reseller.id;
    resellerCode = created.reseller.code;
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  async function eligiblePaisa() {
    return (await resellerBalance(prisma, resellerId)).eligiblePaisa;
  }

  /**
   * Stock a variant, price it for the reseller, place an order at the agreed
   * wholesale price, record the price the reseller sells to *their* customer for,
   * then dispatch and deliver it.
   */
  async function deliveredResellerOrder(options: { label: string; wholesalePaisa?: number; marginPaisa?: number; quantity?: number }) {
    const wholesalePaisa = options.wholesalePaisa ?? 15_000;
    const quantity = options.quantity ?? 1;

    const variant = await createTestVariant(context, { sku: `RS-${options.label}-${Date.now()}`, pricePaisa: 20_000, costPaisa: 12_000 });
    await addTestStock(context, variant.variantId, quantity + 2, 12_000);
    await setResellerPrice(asReseller(), { resellerId, variantId: variant.variantId, pricePaisa: wholesalePaisa, minQuantity: 1 });

    const created = await createResellerOrder(asReseller(), {
      resellerId,
      customerName: "Nusrat Jahan",
      customerPhone: `0171${Math.floor(Math.random() * 8_000_000 + 1_000_000)}`,
      shippingDistrictCode: "26",
      shippingAddressLine: "Station Road, Ishwardi",
      idempotencyKey: `rs4-${options.label}-${randomUUID()}`,
      items: [{ variantId: variant.variantId, quantity, discountPaisa: 0 }],
    });

    // The reseller sells to their own customer at their own price: the wholesale
    // cost plus their margin. This is the amount the courier will collect.
    const marginPaisa = options.marginPaisa ?? 6_000;
    const priced = await recordCollectionChange(asReseller(), {
      orderId: created.order.id,
      amountPaisa: created.costPaisa + marginPaisa,
      reason: "Reseller's own selling price",
    });

    await transitionOrder(staff(), { orderId: created.order.id, status: "CONFIRMED" });
    const dispatched = await dispatchOrder(staff(), { orderId: created.order.id });
    await markOrderDelivered(staff(), created.order.id, "Handed to the reseller");

    return {
      orderId: created.order.id,
      orderNumber: created.order.orderNumber,
      wholesalePaisa,
      marginPaisa,
      costPaisa: priced.resellerCostPaisa ?? 0,
      collectionPaisa: priced.resellerCollectionPaisa ?? 0,
      earningPaisa: priced.resellerEarningPaisa ?? 0,
      codCollectPaisa: priced.codCollectPaisa,
      shipment: dispatched.shipment,
    };
  }

  /** Record the cash the courier collected and give the shipment a tracking code. */
  async function collectCod(input: { orderId: string; shipmentId: string; amountPaisa: number }) {
    const trackingCode = `TRK-${randomUUID().slice(0, 10)}`;
    await prisma.shipment.update({
      where: { id: input.shipmentId },
      data: { trackingCode, expectedCollectionPaisa: input.amountPaisa, codAmountPaisa: input.amountPaisa, status: "DELIVERED" },
    });
    await recordCodCollection(staff(), { orderId: input.orderId, shipmentId: input.shipmentId, collectedPaisa: input.amountPaisa });
    return trackingCode;
  }

  it("gives a new reseller its own price list and applies a markup over the default list", async () => {
    expect(resellerCode).toMatch(/^RS-\d{4}$/);

    const priceList = await prisma.priceList.findFirst({ where: { businessId: context.businessId, resellerId } });
    expect(priceList).not.toBeNull();
    expect(priceList!.channel).toBe("RESELLER");

    const variant = await createTestVariant(context, { sku: `RS-MARK-${Date.now()}`, pricePaisa: 10_000 });
    await withTransaction(async (tx) => {
      await tx.priceListItem.create({
        data: { priceListId: context.priceListId, variantId: variant.variantId, pricePaisa: 10_000, minQuantity: 1 },
      });
    });

    const applied = await applyResellerMarkup(asReseller(), { resellerId, markupBps: 2_000, onlyMissing: true });
    expect(applied.created).toBeGreaterThan(0);

    const item = await prisma.priceListItem.findFirst({ where: { priceListId: priceList!.id, variantId: variant.variantId } });
    expect(item?.pricePaisa).toBe(12_000); // 20% on a 100.00 BDT default price
  });

  it("keeps earnings pending until the COD cash has been reconciled, then makes them payable", async () => {
    const order = await deliveredResellerOrder({ label: "ELIG" });

    // The reseller collects 220.00 and owes the business 150.00 goods + 10.00 packaging,
    // so the margin is 60.00.
    expect(order.costPaisa).toBe(16_000);
    expect(order.collectionPaisa).toBe(22_000);
    expect(order.earningPaisa).toBe(6_000);

    const before = await resellerBalance(prisma, resellerId);
    expect(before.pendingPaisa).toBeGreaterThanOrEqual(6_000);
    expect(before.eligiblePaisa).toBe(0);

    const earning = await prisma.resellerOrderEarning.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(earning.eligibilityStatus).toBe("PENDING");
    expect(earning.earningsPaisa).toBe(6_000);
    // The snapshot columns add up: collected − price charged = earnings.
    expect(earning.collectedPaisa - earning.resellerPricePaisa).toBe(earning.earningsPaisa);

    const ledger = await prisma.resellerLedgerEntry.findMany({ where: { orderId: order.orderId }, orderBy: { createdAt: "asc" } });
    expect(ledger).toHaveLength(2);
    const credit = ledger.find((entry) => entry.direction === "CREDIT")!;
    const packaging = ledger.find((entry) => entry.type === "PACKAGING_CHARGE")!;
    expect(credit.amountPaisa - packaging.amountPaisa).toBe(6_000); // ledger net = earnings
    expect(ledger.every((entry) => entry.status === "PENDING")).toBe(true);

    // Delivered, but the statement has not arrived: nothing may become payable.
    await refreshResellerEligibility(context.businessId, { resellerId });
    expect(await eligiblePaisa()).toBe(0);

    const trackingCode = await collectCod({ orderId: order.orderId, shipmentId: order.shipment.id, amountPaisa: order.codCollectPaisa });
    const imported = await importCourierSettlement(asSettlements(), {
      providerCode: "MANUAL",
      reference: `STMT-ELIG-${Date.now()}`,
      settlementDate: new Date(),
      rows: [{ trackingCode, grossPaisa: order.codCollectPaisa, courierFeePaisa: 600, codChargePaisa: 0 }],
    });

    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(0);
    expect(imported.settlement.status).toBe("RECONCILED");

    const after = await resellerBalance(prisma, resellerId);
    expect(after.eligiblePaisa).toBe(before.eligiblePaisa + 6_000);
    expect(after.pendingPaisa).toBe(before.pendingPaisa - 6_000);

    const promoted = await prisma.resellerLedgerEntry.findMany({ where: { orderId: order.orderId } });
    expect(promoted.every((entry) => entry.status === "ELIGIBLE")).toBe(true);
    expect(promoted.every((entry) => entry.settlementEntryId !== null)).toBe(true);

    const earningAfter = await prisma.resellerOrderEarning.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(earningAfter.eligibilityStatus).toBe("ELIGIBLE");
    expect(earningAfter.eligibleAt).not.toBeNull();
  });

  it("leaves a delivered order unpaid while its statement has not been received", async () => {
    const eligibleBefore = await eligiblePaisa();
    const order = await deliveredResellerOrder({ label: "NOSET" });
    await collectCod({ orderId: order.orderId, shipmentId: order.shipment.id, amountPaisa: order.codCollectPaisa });

    // Cash is recorded but no statement has been imported, so the collection is not
    // attached to a settlement and the earnings must stay pending.
    const earning = await prisma.resellerOrderEarning.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(earning.eligibilityStatus).toBe("PENDING");
    expect(await eligiblePaisa()).toBe(eligibleBefore);

    const collection = await prisma.codCollection.findFirstOrThrow({ where: { shipmentId: order.shipment.id } });
    expect(collection.settlementId).toBeNull();
  });

  it("only unlocks the rows a partially matched statement actually settled", async () => {
    const eligibleBefore = await eligiblePaisa();
    const matchedOrder = await deliveredResellerOrder({ label: "PART-A" });
    const pendingOrder = await deliveredResellerOrder({ label: "PART-B" });

    const matchedTracking = await collectCod({ orderId: matchedOrder.orderId, shipmentId: matchedOrder.shipment.id, amountPaisa: matchedOrder.codCollectPaisa });
    const pendingTracking = await collectCod({ orderId: pendingOrder.orderId, shipmentId: pendingOrder.shipment.id, amountPaisa: pendingOrder.codCollectPaisa });

    const imported = await importCourierSettlement(asSettlements(), {
      providerCode: "MANUAL",
      reference: `STMT-PARTIAL-${Date.now()}`,
      settlementDate: new Date(),
      rows: [
        { trackingCode: matchedTracking, grossPaisa: matchedOrder.codCollectPaisa },
        // The courier collected less than the shipment expected: this row must not
        // unlock anything until a human looks at it.
        { trackingCode: pendingTracking, grossPaisa: pendingOrder.codCollectPaisa - 5_000 },
      ],
    });

    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(1);
    expect(imported.settlement.status).toBe("PARTIALLY_RECONCILED");

    const matchedEarning = await prisma.resellerOrderEarning.findFirstOrThrow({ where: { orderId: matchedOrder.orderId } });
    const pendingEarning = await prisma.resellerOrderEarning.findFirstOrThrow({ where: { orderId: pendingOrder.orderId } });
    expect(matchedEarning.eligibilityStatus).toBe("ELIGIBLE");
    expect(pendingEarning.eligibilityStatus).toBe("PENDING");

    // Closing the statement by hand is refused while a row is still open …
    await expect(reconcileSettlement(asSettlements(), imported.settlement.id)).rejects.toThrow(/need a decision/i);

    // … and the payable balance only grew by the matched order's earnings.
    expect(await eligiblePaisa()).toBe(eligibleBefore + matchedEarning.earningsPaisa);

    // Ignoring the short-paid row closes the statement without unlocking it.
    const openRow = await prisma.courierSettlementEntry.findFirstOrThrow({
      where: { settlementId: imported.settlement.id, status: "UNMATCHED" },
    });
    await resolveSettlementEntry(asSettlements(), { entryId: openRow.id, ignore: true, note: "Courier short-paid; recovering separately" });

    const closed = await prisma.courierSettlement.findUniqueOrThrow({ where: { id: imported.settlement.id } });
    expect(closed.status).toBe("RECONCILED");

    const stillPending = await prisma.resellerOrderEarning.findFirstOrThrow({ where: { orderId: pendingOrder.orderId } });
    expect(stillPending.eligibilityStatus).toBe("PENDING");
    expect(await eligiblePaisa()).toBe(eligibleBefore + matchedEarning.earningsPaisa);
  });

  it("pays out only what is payable and never allocates the same ledger entry twice", async () => {
    const balance = await resellerBalance(prisma, resellerId);
    expect(balance.eligiblePaisa).toBeGreaterThan(0);

    const eligible = await eligiblePayoutEntries(context.businessId, resellerId);
    // The payable pool *is* the ledger: these must agree to the paisa.
    expect(eligible.totalPaisa).toBe(balance.eligiblePaisa);
    expect(eligible.entries.every((entry) => entry.status === "ELIGIBLE" && entry.payoutId === null)).toBe(true);

    // A partial payout: the entries of one order, which is a strict subset of the pool.
    const eliOrder = await prisma.order.findFirstOrThrow({
      where: { businessId: context.businessId, resellerId, resellerEarningPaisa: { gt: 0 } },
      orderBy: { placedAt: "asc" },
    });
    const subset = eligible.entries.filter((entry) => entry.orderId === eliOrder.id);
    const subsetAmount = subset.reduce((total, entry) => total + (entry.direction === "CREDIT" ? entry.amountPaisa : -entry.amountPaisa), 0);
    expect(subset.length).toBeGreaterThan(0);
    expect(subsetAmount).toBeLessThan(balance.eligiblePaisa);

    const created = await createPayout(asReseller(), {
      resellerId,
      ledgerEntryIds: subset.map((entry) => entry.id),
      method: "BKASH",
      accountNumber: "01711000001",
      note: "Partial payout test",
      idempotencyKey: `payout-${randomUUID()}`,
    });

    expect(created.payout.status).toBe("PENDING_APPROVAL");
    expect(created.allocatedPaisa).toBe(subsetAmount);
    expect(created.payout.amountPaisa).toBe(subsetAmount);
    expect(created.entryCount).toBe(subset.length);

    const afterCreation = await resellerBalance(prisma, resellerId);
    expect(afterCreation.eligiblePaisa).toBe(balance.eligiblePaisa - subsetAmount);

    // A reserved entry cannot be taken by a second payout …
    await expect(
      createPayout(asReseller(), {
        resellerId,
        ledgerEntryIds: subset.map((entry) => entry.id),
        method: "BKASH",
        idempotencyKey: `payout-dup-${randomUUID()}`,
      }),
    ).rejects.toThrow(/no longer payable/i);

    // … and a payout can never claim more than the entries it was given.
    await expect(
      createPayout(asReseller(), {
        resellerId,
        ledgerEntryIds: [...subset.map((entry) => entry.id), randomUUID()],
        method: "BKASH",
        idempotencyKey: `payout-bogus-${randomUUID()}`,
      }),
    ).rejects.toThrow(/no longer payable/i);

    await approvePayout(asReseller(), { payoutId: created.payout.id, note: "Checked against the statement" });
    await markPayoutPaid(asReseller(), { payoutId: created.payout.id, transactionReference: `TRX-${Date.now()}` });

    const paid = await prisma.resellerPayout.findUniqueOrThrow({ where: { id: created.payout.id } });
    expect(paid.status).toBe("PAID");
    for (const entry of subset) {
      const row = await prisma.resellerLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(row.status).toBe("PAID");
      expect(row.payoutId).toBe(created.payout.id);
    }

    const afterPayment = await resellerBalance(prisma, resellerId);
    expect(afterPayment.eligiblePaisa).toBe(balance.eligiblePaisa - subsetAmount);
    expect(afterPayment.paidPaisa).toBe(subsetAmount);
    // Paying settles part of the debt: what is still outstanding drops by exactly the
    // amount that was paid, and the three buckets always add up to it.
    expect(afterPayment.outstandingPaisa).toBe(afterCreation.outstandingPaisa - subsetAmount);
    expect(afterPayment.outstandingPaisa).toBe(afterPayment.pendingPaisa + afterPayment.eligiblePaisa + afterPayment.allocatedPaisa);

    // Replaying the same transfer is a safe retry; claiming a *second* transfer on an
    // already-paid payout is refused.
    const replay = await markPayoutPaid(asReseller(), { payoutId: created.payout.id, transactionReference: paid.transactionReference! });
    expect(replay.status).toBe("PAID");
    await expect(markPayoutPaid(asReseller(), { payoutId: created.payout.id, transactionReference: "second-attempt" })).rejects.toThrow(/already paid/i);

    // The database itself refuses a second allocation of the same ledger entry.
    const duplicateAllocation = prisma.resellerPayoutEntry.create({
      data: { payoutId: created.payout.id, ledgerEntryId: subset[0]!.id, amountPaisa: 1 },
    });
    await expect(duplicateAllocation).rejects.toThrow();

    // The rest of the pool is still payable and can be paid out separately.
    const remaining = await eligiblePayoutEntries(context.businessId, resellerId);
    expect(remaining.totalPaisa).toBe(afterPayment.eligiblePaisa);
    expect(remaining.entries.some((entry) => entry.id === subset[0]!.id)).toBe(false);
  });

  it("releases an allocated entry when the order is cancelled before the payout is paid", async () => {
    const order = await deliveredResellerOrder({ label: "REV-A" });
    const trackingCode = await collectCod({ orderId: order.orderId, shipmentId: order.shipment.id, amountPaisa: order.codCollectPaisa });

    await importCourierSettlement(asSettlements(), {
      providerCode: "MANUAL",
      reference: `STMT-REVA-${Date.now()}`,
      rows: [{ trackingCode, grossPaisa: order.codCollectPaisa }],
    });

    const outstandingBefore = (await resellerBalance(prisma, resellerId)).outstandingPaisa;
    const entries = await prisma.resellerLedgerEntry.findMany({ where: { orderId: order.orderId, status: "ELIGIBLE" } });
    const credit = entries.find((entry) => entry.direction === "CREDIT")!;
    expect(credit).toBeDefined();

    const payout = await createPayout(asReseller(), {
      resellerId,
      ledgerEntryIds: [credit.id],
      method: "BKASH",
      idempotencyKey: `payout-reva-${randomUUID()}`,
    });
    expect(payout.payout.status).toBe("PENDING_APPROVAL");

    await cancelOrder(staff(), { orderId: order.orderId, reason: "Customer refused the delivery", restock: true });

    // The claim is gone, the entry is void, and the payout that was waiting on it can
    // never be paid.
    const payoutEntries = await prisma.resellerPayoutEntry.findMany({ where: { payoutId: payout.payout.id } });
    expect(payoutEntries).toHaveLength(0);

    const creditAfter = await prisma.resellerLedgerEntry.findUniqueOrThrow({ where: { id: credit.id } });
    expect(creditAfter.status).toBe("VOID");
    expect(creditAfter.payoutId).toBeNull();
    expect(creditAfter.voidedAt).not.toBeNull();

    const payoutAfter = await prisma.resellerPayout.findUniqueOrThrow({ where: { id: payout.payout.id } });
    expect(payoutAfter.status).toBe("CANCELLED");
    expect(payoutAfter.cancelReason).toMatch(/cancelled/i);

    const earning = await prisma.resellerOrderEarning.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(earning.eligibilityStatus).toBe("VOID");

    // Nothing extra was posted for an entry that was never paid, and the balance drops
    // by exactly the earning that is no longer owed.
    expect(await prisma.resellerLedgerEntry.count({ where: { orderId: order.orderId, type: "REVERSAL" } })).toBe(0);
    expect((await resellerBalance(prisma, resellerId)).outstandingPaisa).toBe(outstandingBefore - order.earningPaisa);
  });

  it("reverses a paid entry when the order is cancelled after the money moved", async () => {
    const order = await deliveredResellerOrder({ label: "REV-B" });
    const trackingCode = await collectCod({ orderId: order.orderId, shipmentId: order.shipment.id, amountPaisa: order.codCollectPaisa });

    await importCourierSettlement(asSettlements(), {
      providerCode: "MANUAL",
      reference: `STMT-REVB-${Date.now()}`,
      rows: [{ trackingCode, grossPaisa: order.codCollectPaisa }],
    });

    const credit = (await prisma.resellerLedgerEntry.findMany({ where: { orderId: order.orderId, status: "ELIGIBLE" } })).find(
      (entry) => entry.direction === "CREDIT",
    )!;
    const packagingDebit = await prisma.resellerLedgerEntry.findFirstOrThrow({ where: { orderId: order.orderId, type: "PACKAGING_CHARGE" } });

    const payout = await createPayout(asReseller(), {
      resellerId,
      ledgerEntryIds: [credit.id],
      method: "BKASH",
      idempotencyKey: `payout-revb-${randomUUID()}`,
    });
    await approvePayout(asReseller(), { payoutId: payout.payout.id });
    await markPayoutPaid(asReseller(), { payoutId: payout.payout.id, transactionReference: `TRX-REVB-${Date.now()}` });

    const creditPaid = await prisma.resellerLedgerEntry.findUniqueOrThrow({ where: { id: credit.id } });
    expect(creditPaid.status).toBe("PAID");

    const outstandingBeforeCancel = (await resellerBalance(prisma, resellerId)).outstandingPaisa;
    await cancelOrder(staff(), { orderId: order.orderId, reason: "Delivered by mistake", restock: true });

    // The paid entry is never edited: an opposing REVERSAL entry carries the correction.
    const reversed = await prisma.resellerLedgerEntry.findFirstOrThrow({ where: { reversesEntryId: credit.id } });
    expect(reversed.type).toBe("REVERSAL");
    expect(reversed.direction).toBe("DEBIT");
    expect(reversed.amountPaisa).toBe(credit.amountPaisa);
    expect(reversed.status).toBe("ELIGIBLE");

    const stillPaid = await prisma.resellerLedgerEntry.findUniqueOrThrow({ where: { id: credit.id } });
    expect(stillPaid.status).toBe("PAID");

    const earning = await prisma.resellerOrderEarning.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(earning.eligibilityStatus).toBe("VOID");

    // The reseller has to hand the 7.00 they were paid back (the reversal), while the
    // packaging charge is forgiven because the sale never happened — so the debt moves
    // by exactly those two amounts and the reversal lands in the payable pool for a
    // future payout to net off.
    const after = await resellerBalance(prisma, resellerId);
    expect(after.outstandingPaisa).toBe(outstandingBeforeCancel + packagingDebit.amountPaisa - credit.amountPaisa);

    // The only thing left of this order in the payable pool is the reversal itself.
    const liveEntries = await prisma.resellerLedgerEntry.findMany({ where: { orderId: order.orderId, status: { in: ["PENDING", "ELIGIBLE"] } } });
    expect(liveEntries).toHaveLength(1);
    expect(liveEntries[0]!.type).toBe("REVERSAL");
  });

  it("records a collection change and a manual adjustment as new ledger rows", async () => {
    const order = await deliveredResellerOrder({ label: "ADJ" });

    const changed = await recordCollectionChange(asReseller(), {
      orderId: order.orderId,
      amountPaisa: order.collectionPaisa + 2_000,
      reason: "Reseller agreed to collect the delivery charge too",
    });
    expect(changed.resellerCollectionPaisa).toBe(order.collectionPaisa + 2_000);

    // History is append-only: the initial amount, the reseller's selling price, and
    // this correction are all still there.
    const history = await prisma.resellerCollectionChange.findMany({ where: { orderId: order.orderId }, orderBy: { createdAt: "asc" } });
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0]!.previousPaisa).toBeNull();
    const latest = history[history.length - 1]!;
    expect(latest.previousPaisa).toBe(order.collectionPaisa);
    expect(latest.newPaisa).toBe(order.collectionPaisa + 2_000);

    const before = await resellerBalance(prisma, resellerId);
    await recordLedgerAdjustment(asReseller(), {
      resellerId,
      amountPaisa: parseAmountToPaisa("250.00"),
      description: "Agreed compensation for a late delivery",
      reason: "Support ticket 4471",
    });

    const after = await resellerBalance(prisma, resellerId);
    expect(after.eligiblePaisa).toBe(before.eligiblePaisa + 25_000);

    const adjustment = await prisma.resellerLedgerEntry.findFirstOrThrow({ where: { resellerId, type: "ADJUSTMENT" } });
    expect(adjustment.status).toBe("ELIGIBLE");
    expect(adjustment.direction).toBe("CREDIT");
  });

  it("keeps the financial reports in step with the ledger they are derived from", async () => {
    const range = resolveRange({ from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });

    const balance = await resellerBalance(prisma, resellerId);
    const earningsReport = await runReport("reseller-earnings", context.businessId, range);
    const row = earningsReport.rows.find((entry) => entry.code === resellerCode);
    expect(row).toBeDefined();
    expect(Number(row!.eligiblePaisa)).toBe(balance.eligiblePaisa);
    expect(Number(row!.awaitingSettlementPaisa)).toBe(balance.pendingPaisa);
    expect(Number(row!.paidPaisa)).toBe(balance.paidPaisa);

    // Revenue in the sales report equals the order totals for the same window.
    const salesReport = await runReport("sales-by-date", context.businessId, range);
    const orderTotals = await prisma.order.aggregate({
      where: {
        businessId: context.businessId,
        deletedAt: null,
        status: { in: ["CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "COMPLETED"] },
        placedAt: { gte: range.from, lte: range.to },
      },
      _sum: { grandTotalPaisa: true },
    });
    expect(salesReport.totals?.revenuePaisa).toBe(orderTotals._sum.grandTotalPaisa ?? 0);

    // Gross profit is computed, not asserted: revenue less each cost line.
    const profit = await runReport("profit-summary", context.businessId, range);
    const totals = profit.totals!;
    const revenue = totals.revenuePaisa ?? 0;
    const inventoryCost = totals.inventoryCostPaisa ?? 0;
    const packaging = totals.packagingPaisa ?? 0;
    const courier = totals.courierExpensePaisa ?? 0;
    const refunded = totals.refundedPaisa ?? 0;
    const payouts = totals.resellerPayoutsPaisa ?? 0;
    expect(totals.grossProfitPaisa).toBe(revenue - inventoryCost - packaging - courier - refunded);
    expect(payouts).toBeGreaterThan(0);
    // Payouts move margin that was never our revenue, so they are not an expense.
    expect(totals.grossProfitPaisa).not.toBe(revenue - inventoryCost - packaging - courier - refunded - payouts);
    // The report must never present revenue itself as profit.
    expect(profit.rows[0]!.line).toMatch(/Revenue/);
    expect(profit.totals!.grossProfitPaisa).toBeLessThan(revenue);

    // Inventory valuation counts the same on-hand units the stock ledger holds.
    const valuation = await runReport("inventory-valuation", context.businessId, range);
    const balanceUnits = await prisma.inventoryBalance.aggregate({
      where: { variant: { product: { businessId: context.businessId } } },
      _sum: { onHand: true },
    });
    expect(valuation.totals?.onHand).toBe(balanceUnits._sum.onHand ?? 0);

    // Unmatched statement rows are reported instead of being written off.
    const courierReport = await runReport("courier-charges", context.businessId, range);
    const unmatchedSection = courierReport.sections?.find((section) => /Unmatched/i.test(section.title));
    expect(unmatchedSection).toBeDefined();
    const disputed = await prisma.courierSettlementEntry.count({
      where: { settlement: { businessId: context.businessId }, status: { in: ["UNMATCHED", "DISPUTED"] } },
    });
    expect(unmatchedSection!.rows.length).toBe(disputed);
  });
});
