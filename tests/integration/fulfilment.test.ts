import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, withTransaction } from "@/lib/db/client";
import { applyStockMovement } from "@/modules/inventory/service";
import { createOrder, dispatchOrder, markOrderDelivered, transitionOrder, type OrderActor } from "@/modules/orders/service";
import { createOrderInputSchema } from "@/modules/orders/schemas";
import { processShipmentCreateEvent, updateShipmentStatus } from "@/modules/couriers/service";
import { buildPathaoOrderBody, mapPathaoStatus } from "@/modules/couriers/providers/pathao-outgoing-data";
import { buildSteadfastOrderBody, mapSteadfastStatus } from "@/modules/couriers/providers/steadfast-outgoing-data";
import { buildCarryBeeOrderBody, mapCarryBeeStatus } from "@/modules/couriers/providers/carrybee-outgoing-data";
import { importCourierSettlement, reconcileSettlement, resolveSettlementEntry } from "@/modules/settlements/service";
import { parseStatementCsv } from "@/modules/settlements/csv";
import { completeExchange, createExchangeRequest, inspectExchange, moveExchangeStatus } from "@/modules/exchanges/service";
import { recordCodCollection } from "@/modules/payments/service";
import {
  createTestBusiness,
  createTestStorefront,
  createTestVariant,
  databaseReachable,
  destroyTestBusiness,
  readBalance,
  type TestContext,
} from "./fixtures";

/**
 * Fulfilment: courier dispatch, courier settlements and exchanges.
 *
 * No provider HTTP call is made anywhere in this suite: the outbox path is tested
 * with credentials that do not exist (which is exactly what a half-configured
 * provider looks like), and the provider payload builders are tested as pure
 * functions against the documented request shapes.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("fulfilment (database)", () => {
  let context: TestContext;
  let storefrontId: string;

  const actor = (): OrderActor => ({ businessId: context.businessId, userId: context.userId, actorType: "USER", actorLabel: "test-staff" });

  beforeAll(async () => {
    context = await createTestBusiness("fulfilment");
    const storefront = await createTestStorefront(context);
    storefrontId = storefront.storefrontId;
    await prisma.courierProvider.create({
      data: { businessId: context.businessId, code: "MANUAL", name: "Own delivery", isEnabled: true, priority: 1 },
    });
    // An enabled provider that has an adapter but no credentials: exactly the state a
    // half-configured integration is in, and the state the retry path must survive.
    await prisma.courierProvider.create({
      data: { businessId: context.businessId, code: "STEADFAST", name: "Steadfast", isEnabled: true, testMode: true, priority: 10 },
    });
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  async function stock(variantId: string, quantity: number) {
    return withTransaction((tx) =>
      applyStockMovement(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId,
        type: "OPENING",
        onHandDelta: quantity,
        unitCostPaisa: 3_000,
        actorUserId: context.userId,
      }),
    );
  }

  async function deliveredOrder(variantId: string, quantity: number) {
    const created = await createOrder(
      actor(),
      createOrderInputSchema.parse({
        channel: "ADMIN",
        storefrontId,
        customerName: "Karim Mia",
        customerPhone: `01712${Math.floor(Math.random() * 900000 + 100000)}`,
        shippingDistrictCode: "26",
        shippingAddressLine: "Station Road, Ishwardi",
        items: [{ variantId, quantity }],
        idempotencyKey: `fulfil-${randomUUID()}`,
      }),
    );
    await transitionOrder(actor(), { orderId: created.order.id, status: "CONFIRMED" });
    const dispatched = await dispatchOrder(actor(), { orderId: created.order.id });
    await markOrderDelivered(actor(), created.order.id);
    return { orderId: created.order.id, orderNumber: created.order.orderNumber, shipment: dispatched.shipment };
  }

  it("keeps a shipment PENDING with a retry delay when provider credentials are missing", async () => {
    const { variantId } = await createTestVariant(context, { sku: `FUL-OUT-${Date.now()}`, pricePaisa: 9_000 });
    await stock(variantId, 2);

    const { shipment } = await deliveredOrder(variantId, 1);
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { shipmentId: shipment.id } });

    const result = await processShipmentCreateEvent(event.id);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();

    const updatedEvent = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updatedEvent.status).toBe("PENDING");
    expect(updatedEvent.attempts).toBe(1);
    expect(updatedEvent.availableAt.getTime()).toBeGreaterThan(Date.now());

    const updatedShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(updatedShipment.failureReason).toBeTruthy();
    expect(updatedShipment.providerConsignmentId).toBeNull();
  });

  it("builds provider request bodies from the shipment snapshot", async () => {
    const pathao = buildPathaoOrderBody({
      internalCode: "SHP-1",
      merchantOrderId: "ORD-1",
      recipientName: "Karim Mia",
      recipientPhone: "01712345678",
      recipientPhoneNormalized: "8801712345678",
      recipientDistrictCode: "26",
      recipientAddress: "Station Road, Ishwardi",
      recipientArea: "Ishwardi",
      recipientNote: null,
      itemDescription: "Test product",
      itemQuantity: 2,
      declaredWeightGrams: 500,
      codAmountPaisa: 125_050,
      deliveryType: "48",
      providerConfig: { storeId: 42, cityIds: { "26": 1 }, zoneIds: { "26": 2 } },
    });
    expect(pathao.delivery_type).toBe(48);
    expect(pathao.amount_to_collect).toBe(1250.5);
    expect(pathao.item_weight).toBe(0.5);
    expect(pathao.recipient_phone).toBe("8801712345678");
    expect(pathao.recipient_city).toBe(1);

    const steadfast = buildSteadfastOrderBody({
      internalCode: "SHP-1",
      merchantOrderId: "ORD-1",
      recipientName: "Karim Mia",
      recipientPhone: "01712345678",
      recipientPhoneNormalized: "8801712345678",
      recipientDistrictCode: "26",
      recipientAddress: "Station Road, Ishwardi",
      recipientArea: null,
      recipientNote: null,
      itemDescription: "Test product",
      itemQuantity: 2,
      declaredWeightGrams: 500,
      codAmountPaisa: 125_050,
      deliveryType: null,
      providerConfig: {},
    });
    expect(steadfast.cod_amount).toBe(1250.5);
    expect(steadfast.invoice).toBe("ORD-1");

    const carrybee = buildCarryBeeOrderBody({
      internalCode: "SHP-1",
      merchantOrderId: "ORD-1",
      recipientName: "Karim Mia",
      recipientPhone: "01712345678",
      recipientPhoneNormalized: "8801712345678",
      recipientDistrictCode: "26",
      recipientAddress: "Station Road, Ishwardi",
      recipientArea: null,
      recipientNote: null,
      itemDescription: "Test product",
      itemQuantity: 2,
      declaredWeightGrams: 500,
      codAmountPaisa: 125_050,
      deliveryType: null,
      providerConfig: { storeId: "7", cityIds: { "26": 1 }, zoneIds: { "26": 2 } },
    });
    expect(carrybee.collectable_amount).toBe(1250.5);
    expect(carrybee.store_id).toBe("7");

    // Provider status text always lands on one of our statuses.
    expect(mapPathaoStatus("Delivered").status).toBe("DELIVERED");
    expect(mapSteadfastStatus("in_review").status).toBeTruthy();
    expect(mapCarryBeeStatus("in_transit").status).toBeTruthy();
  });

  it("records a courier status change once and keeps the order in step", async () => {
    const { variantId } = await createTestVariant(context, { sku: `FUL-ST-${Date.now()}` });
    await stock(variantId, 1);
    const { orderId, shipment } = await deliveredOrder(variantId, 1);

    await updateShipmentStatus({ shipmentId: shipment.id, status: "IN_TRANSIT", providerStatusRaw: "in_transit", source: "WEBHOOK" });
    const again = await updateShipmentStatus({ shipmentId: shipment.id, status: "IN_TRANSIT", source: "WEBHOOK" });

    const history = await prisma.shipmentStatusHistory.findMany({ where: { shipmentId: shipment.id } });
    expect(history.filter((entry) => entry.toStatus === "IN_TRANSIT")).toHaveLength(1);
    expect(again.status).toBe("IN_TRANSIT");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("DELIVERED");
  });

  it("matches an imported statement, marks the cash collected and refuses a duplicate reference", async () => {
    const { variantId } = await createTestVariant(context, { sku: `FUL-SET-${Date.now()}`, pricePaisa: 30_000 });
    await stock(variantId, 1);
    const { orderId, shipment } = await deliveredOrder(variantId, 1);

    const trackingCode = `TRK-${Date.now()}`;
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { trackingCode, expectedCollectionPaisa: 30_000, codAmountPaisa: 30_000, status: "DELIVERED" },
    });
    await recordCodCollection(actor(), { orderId, shipmentId: shipment.id, collectedPaisa: 30_000 });

    const reference = `STMT-${Date.now()}`;
    const imported = await importCourierSettlement(
      { businessId: context.businessId, userId: context.userId },
      {
        providerCode: "MANUAL",
        reference,
        settlementDate: new Date(),
        rows: [{ trackingCode, grossPaisa: 30_000, courierFeePaisa: 700, codChargePaisa: 300 }],
      },
    );

    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(0);
    expect(imported.settlement.status).toBe("RECONCILED");
    expect(imported.settlement.netReceivedPaisa).toBe(29_000);

    const updatedShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(updatedShipment.collectedPaisa).toBe(30_000);
    expect(updatedShipment.courierChargePaisa).toBe(700);

    const cod = await prisma.codCollection.findFirstOrThrow({ where: { shipmentId: shipment.id } });
    expect(cod.status).toBe("SETTLED");
    expect(cod.settlementId).toBe(imported.settlement.id);
    expect(cod.netPaisa).toBe(29_000);

    // Importing the same statement twice is refused, so cash cannot be added twice.
    await expect(
      importCourierSettlement(
        { businessId: context.businessId, userId: context.userId },
        { providerCode: "MANUAL", reference, rows: [{ trackingCode, grossPaisa: 30_000 }] },
      ),
    ).rejects.toThrow(/already imported/i);
  });

  it("flags a row that does not match, then closes the statement once it is resolved", async () => {
    const settlement = await importCourierSettlement(
      { businessId: context.businessId, userId: context.userId },
      {
        providerCode: "MANUAL",
        reference: `STMT-OPEN-${Date.now()}`,
        rows: [
          { trackingCode: "TRK-DOES-NOT-EXIST", grossPaisa: 5_000, courierFeePaisa: 100 },
          { orderNumber: "ORD-DOES-NOT-EXIST", grossPaisa: 2_000 },
        ],
      },
    );

    expect(settlement.unmatched).toBe(2);
    expect(settlement.settlement.status).toBe("DISPUTED");

    const entries = await prisma.courierSettlementEntry.findMany({ where: { settlementId: settlement.settlement.id } });
    expect(entries.every((entry) => entry.status === "UNMATCHED")).toBe(true);

    await expect(
      reconcileSettlement({ businessId: context.businessId, userId: context.userId }, settlement.settlement.id),
    ).rejects.toThrow(/need a decision/i);

    for (const entry of entries) {
      await resolveSettlementEntry({ businessId: context.businessId, userId: context.userId }, { entryId: entry.id, ignore: true, note: "Not our shipment" });
    }

    const reconciled = await reconcileSettlement({ businessId: context.businessId, userId: context.userId }, settlement.settlement.id);
    expect(reconciled.status).toBe("RECONCILED");
  });

  it("runs a partial exchange: credit, replacement charge, inspection and restock", async () => {
    const original = await createTestVariant(context, { sku: `EX-ORIG-${Date.now()}`, pricePaisa: 20_000, costPaisa: 12_000 });
    const replacement = await createTestVariant(context, { sku: `EX-REPL-${Date.now()}`, pricePaisa: 24_000, costPaisa: 15_000 });
    await stock(original.variantId, 4);
    await stock(replacement.variantId, 3);

    const { orderId, orderNumber } = await deliveredOrder(original.variantId, 2);
    const order = await prisma.order.findFirstOrThrow({ where: { id: orderId }, include: { items: true } });
    const orderItem = order.items[0]!;

    await prisma.exchangeReason.create({
      data: { businessId: context.businessId, code: `SIZE-${Date.now()}`, label: "Wrong size", deliveryChargePaisa: 1_000, requiresApproval: false },
    });
    const reason = await prisma.exchangeReason.findFirstOrThrow({ where: { businessId: context.businessId, requiresApproval: false } });

    const { exchange } = await createExchangeRequest(
      { businessId: context.businessId, userId: context.userId },
      {
        orderId,
        reasonCode: reason.code,
        channel: "STAFF",
        returnItems: [{ orderItemId: orderItem.id, variantId: original.variantId, quantity: 1 }],
        replacementItems: [{ variantId: replacement.variantId, quantity: 1 }],
        idempotencyKey: `ex-${randomUUID()}`,
      },
    );

    // credit 200.00 (snapshot) - charge 240.00 (current price) + 10.00 delivery = 50.00 to collect
    expect(exchange.returnValuePaisa).toBe(20_000);
    expect(exchange.replacementValuePaisa).toBe(24_000);
    expect(exchange.deliveryChargePaisa).toBe(1_000);
    expect(exchange.differencePaisa).toBe(5_000);
    expect(exchange.status).toBe("APPROVED");
    expect(exchange.isPartial).toBe(true);

    // Stock is only written back after inspection.
    let originalBalance = await readBalance(context.locationId, original.variantId);
    expect(originalBalance.onHand).toBe(2);

    await moveExchangeStatus(
      { businessId: context.businessId, userId: context.userId },
      { exchangeId: exchange.id, from: ["APPROVED", "IN_TRANSIT"], to: "RECEIVED", note: "Parcel arrived at the warehouse" },
    );

    const items = await prisma.exchangeItem.findMany({ where: { exchangeRequestId: exchange.id } });
    const returnItem = items.find((item) => item.direction === "RETURN")!;

    const inspected = await inspectExchange(
      { businessId: context.businessId, userId: context.userId },
      { exchangeId: exchange.id, items: [{ itemId: returnItem.id, outcome: "SELLABLE", quantity: 1 }] },
    );
    expect(inspected.restocked).toBe(1);

    originalBalance = await readBalance(context.locationId, original.variantId);
    expect(originalBalance.onHand).toBe(3);

    const completed = await completeExchange({ businessId: context.businessId, userId: context.userId }, { exchangeId: exchange.id });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.collectionStatus).toBe("DUE");

    const replacementBalance = await readBalance(context.locationId, replacement.variantId);
    expect(replacementBalance.onHand).toBe(2);

    const orderItemAfter = await prisma.orderItem.findUniqueOrThrow({ where: { id: orderItem.id } });
    expect(orderItemAfter.returnedQuantity).toBe(1);
    expect(orderItemAfter.exchangedQuantity).toBe(1);

    const statuses = await prisma.exchangeStatusHistory.findMany({ where: { exchangeRequestId: exchange.id }, orderBy: { createdAt: "asc" } });
    expect(statuses.map((entry) => entry.toStatus)).toContain("COMPLETED");
    expect(orderNumber).toBeTruthy();
  });

  it("raises a refund when the replacement is cheaper than the returned item", async () => {
    const expensive = await createTestVariant(context, { sku: `EX-EXP-${Date.now()}`, pricePaisa: 40_000, costPaisa: 25_000 });
    const cheap = await createTestVariant(context, { sku: `EX-CHP-${Date.now()}`, pricePaisa: 15_000, costPaisa: 9_000 });
    await stock(expensive.variantId, 2);
    await stock(cheap.variantId, 2);

    const { orderId } = await deliveredOrder(expensive.variantId, 1);
    const order = await prisma.order.findFirstOrThrow({ where: { id: orderId }, include: { items: true } });
    const reason = await prisma.exchangeReason.findFirstOrThrow({ where: { businessId: context.businessId } });

    const { exchange } = await createExchangeRequest(
      { businessId: context.businessId, userId: context.userId },
      {
        orderId,
        reasonCode: reason.code,
        channel: "STAFF",
        returnItems: [{ orderItemId: order.items[0]!.id, variantId: expensive.variantId, quantity: 1 }],
        replacementItems: [{ variantId: cheap.variantId, quantity: 1 }],
      },
    );
    // credit 400.00 − replacement 150.00 − 10.00 delivery fee charged by the reason
    expect(exchange.differencePaisa).toBe(-24_000);

    await prisma.exchangeRequest.update({ where: { id: exchange.id }, data: { status: "RECEIVED" } });
    const items = await prisma.exchangeItem.findMany({ where: { exchangeRequestId: exchange.id } });
    const returnItem = items.find((item) => item.direction === "RETURN")!;

    await inspectExchange(
      { businessId: context.businessId, userId: context.userId },
      { exchangeId: exchange.id, items: [{ itemId: returnItem.id, outcome: "DAMAGED", quantity: 1 }] },
    );

    const completed = await completeExchange({ businessId: context.businessId, userId: context.userId }, { exchangeId: exchange.id });
    expect(completed.status).toBe("COMPLETED");

    const refund = await prisma.refund.findFirstOrThrow({ where: { exchangeRequestId: exchange.id } });
    expect(refund.amountPaisa).toBe(24_000);
    expect(refund.method).toBe("MANUAL");

    // A damaged return never goes back to sellable stock.
    const balance = await readBalance(context.locationId, expensive.variantId);
    expect(balance.onHand).toBe(1);
    expect(balance.damaged).toBe(1);
  });

  it("parses courier statement CSV rows", () => {
    const rows = parseStatementCsv(
      [
        "tracking_code,order_number,gross,courier_fee,cod_fee,other_deduction",
        "TRK-1,ORD-1,1250.00,60,12.50,0",
        ",ORD-2,500.50,0,0,0",
        "",
        "TRK-3,,100,5,5,1.25",
      ].join("\n"),
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]!.grossPaisa).toBe(125_000);
    expect(rows[0]!.courierFeePaisa).toBe(6_000);
    expect(rows[0]!.codChargePaisa).toBe(1_250);
    expect(rows[1]!.orderNumber).toBe("ORD-2");
    expect(rows[2]!.otherDeductionPaisa).toBe(125);
  });
});
