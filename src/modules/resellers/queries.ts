import "server-only";
import { prisma } from "@/lib/db/client";
import { resellerBalance } from "./earnings";

/** Read queries for the reseller screens, the ledger and the reports. */

const RESELLER_LIST_INCLUDE = {
  priceList: { select: { id: true, name: true, status: true, _count: { select: { items: true } } } },
  _count: { select: { orders: true, payouts: true } },
} as const;

export async function listResellers(
  businessId: string,
  query: { search?: string; status?: string; page?: number; pageSize?: number; sortBy?: string; sortDir?: "asc" | "desc" } = {},
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const sortDir = query.sortDir === "asc" ? "asc" : "desc";
  const sortBy = ["name", "code", "createdAt", "status"].includes(query.sortBy ?? "") ? query.sortBy! : "createdAt";

  const where = {
    businessId,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "ACTIVE" } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { code: { contains: query.search, mode: "insensitive" as const } },
            { phone: { contains: query.search } },
            { businessName: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.reseller.findMany({
      where,
      orderBy: { [sortBy]: sortDir } as never,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: RESELLER_LIST_INCLUDE,
    }),
    prisma.reseller.count({ where }),
  ]);

  // Balances come from the ledger, one grouped query instead of N.
  const balances = await prisma.resellerLedgerEntry.groupBy({
    by: ["resellerId", "status", "direction", "payoutId"],
    where: { businessId, resellerId: { in: rows.map((row) => row.id) } },
    _sum: { amountPaisa: true },
  });

  type Buckets = { pendingPaisa: number; eligiblePaisa: number; allocatedPaisa: number; paidPaisa: number };
  const emptyBalance = (): Buckets => ({ pendingPaisa: 0, eligiblePaisa: 0, allocatedPaisa: 0, paidPaisa: 0 });

  const balanceByReseller = new Map<string, Buckets>();
  for (const row of balances) {
    const entry = balanceByReseller.get(row.resellerId) ?? emptyBalance();
    const signed = (row.direction === "CREDIT" ? 1 : -1) * (row._sum.amountPaisa ?? 0);
    if (row.status === "PENDING") entry.pendingPaisa += signed;
    else if (row.status === "PAID") entry.paidPaisa += signed;
    else if (row.status === "ELIGIBLE" && row.payoutId) entry.allocatedPaisa += signed;
    else if (row.status === "ELIGIBLE") entry.eligiblePaisa += signed;
    balanceByReseller.set(row.resellerId, entry);
  }

  return {
    rows: rows.map((row) => ({ ...row, balance: balanceByReseller.get(row.id) ?? emptyBalance() })),
    total,
    page,
    pageSize,
  };
}

export async function resellerStats(businessId: string) {
  const [active, suspended, pendingEntries, eligibleEntries, allocatedEntries, paidEntries, payoutsQueued] = await Promise.all([
    prisma.reseller.count({ where: { businessId, status: "ACTIVE" } }),
    prisma.reseller.count({ where: { businessId, status: "SUSPENDED" } }),
    prisma.resellerLedgerEntry.aggregate({ where: { businessId, status: "PENDING" }, _sum: { amountPaisa: true } }),
    // Payable now excludes entries a payout already claimed but has not paid yet.
    prisma.resellerLedgerEntry.groupBy({
      by: ["direction"],
      where: { businessId, status: "ELIGIBLE", payoutId: null },
      _sum: { amountPaisa: true },
    }),
    prisma.resellerLedgerEntry.groupBy({
      by: ["direction"],
      where: { businessId, status: "ELIGIBLE", payoutId: { not: null } },
      _sum: { amountPaisa: true },
    }),
    prisma.resellerLedgerEntry.groupBy({ by: ["direction"], where: { businessId, status: "PAID" }, _sum: { amountPaisa: true } }),
    prisma.resellerPayout.count({ where: { businessId, status: { in: ["PENDING_APPROVAL", "APPROVED"] } } }),
  ]);

  const signed = (rows: Array<{ direction: string; _sum: { amountPaisa: number | null } }>) =>
    rows.reduce((total, row) => total + (row.direction === "CREDIT" ? 1 : -1) * (row._sum.amountPaisa ?? 0), 0);

  return {
    active,
    suspended,
    awaitingSettlementPaisa: pendingEntries._sum.amountPaisa ?? 0,
    eligiblePaisa: signed(eligibleEntries),
    allocatedPaisa: signed(allocatedEntries),
    paidPaisa: signed(paidEntries),
    payoutsQueued,
  };
}

export async function getResellerDetail(businessId: string, resellerId: string) {
  const reseller = await prisma.reseller.findFirst({
    where: { id: resellerId, businessId },
    include: {
      priceList: { select: { id: true, name: true, status: true } },
      user: { select: { id: true, email: true, name: true, lastLoginAt: true } },
    },
  });
  if (!reseller) return null;

  const [balance, orderStats, recentOrders, pendingEarnings, recentPayouts, collectionChanges] = await Promise.all([
    resellerBalance(prisma, reseller.id),
    prisma.order.aggregate({
      where: { businessId, resellerId: reseller.id, deletedAt: null, status: { notIn: ["CANCELLED"] } },
      _count: { _all: true },
      _sum: { grandTotalPaisa: true, resellerCollectionPaisa: true, resellerEarningPaisa: true },
    }),
    prisma.order.findMany({
      where: { businessId, resellerId: reseller.id, deletedAt: null },
      orderBy: { placedAt: "desc" },
      take: 15,
      include: { shipments: { select: { id: true, status: true, trackingCode: true } } },
    }),
    prisma.resellerOrderEarning.groupBy({
      by: ["eligibilityStatus"],
      where: { businessId, resellerId: reseller.id },
      _sum: { earningsPaisa: true },
      _count: { _all: true },
    }),
    prisma.resellerPayout.findMany({ where: { businessId, resellerId: reseller.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.resellerCollectionChange.findMany({
      where: { resellerId: reseller.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { order: { select: { id: true, orderNumber: true } } },
    }),
  ]);

  return {
    reseller,
    balance,
    orderStats: {
      orders: orderStats._count._all,
      salesPaisa: orderStats._sum.grandTotalPaisa ?? 0,
      collectedPaisa: orderStats._sum.resellerCollectionPaisa ?? 0,
      earningPaisa: orderStats._sum.resellerEarningPaisa ?? 0,
    },
    recentOrders,
    pendingEarnings,
    recentPayouts,
    collectionChanges,
  };
}

export async function listResellerOrders(
  businessId: string,
  resellerId: string,
  query: { status?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

  const where = {
    businessId,
    resellerId,
    deletedAt: null,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "PENDING" } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        items: { select: { id: true, productName: true, variantName: true, quantity: true, lineTotalPaisa: true } },
        shipments: { select: { id: true, status: true, trackingCode: true, courierChargePaisa: true, codCollection: { select: { id: true, settlementId: true, netPaisa: true, status: true } } } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  const earnings = await prisma.resellerOrderEarning.findMany({ where: { orderId: { in: rows.map((row) => row.id) } } });
  const earningsByOrder = new Map(earnings.map((earning) => [earning.orderId, earning]));

  return { rows: rows.map((row) => ({ ...row, earning: earningsByOrder.get(row.id) ?? null })), total, page, pageSize };
}

export async function listPayouts(
  businessId: string,
  query: { search?: string; status?: string; resellerId?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

  const where = {
    businessId,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "PENDING_APPROVAL" } : {}),
    ...(query.resellerId ? { resellerId: query.resellerId } : {}),
    ...(query.search
      ? {
          OR: [
            { payoutNumber: { contains: query.search, mode: "insensitive" as const } },
            { transactionReference: { contains: query.search, mode: "insensitive" as const } },
            { reseller: { name: { contains: query.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total, sums] = await Promise.all([
    prisma.resellerPayout.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { reseller: { select: { id: true, name: true, code: true } }, _count: { select: { entries: true } } },
    }),
    prisma.resellerPayout.count({ where }),
    prisma.resellerPayout.aggregate({ where, _sum: { amountPaisa: true } }),
  ]);

  return { rows, total, page, pageSize, totalPaisa: sums._sum.amountPaisa ?? 0 };
}

export async function payoutStats(businessId: string) {
  const groups = await prisma.resellerPayout.groupBy({
    by: ["status"],
    where: { businessId },
    _sum: { amountPaisa: true },
    _count: { _all: true },
  });

  const byStatus = new Map(groups.map((group) => [group.status, group]));
  return {
    awaitingApproval: byStatus.get("PENDING_APPROVAL")?._count._all ?? 0,
    approvedPaisa: byStatus.get("APPROVED")?._sum.amountPaisa ?? 0,
    paidPaisa: byStatus.get("PAID")?._sum.amountPaisa ?? 0,
    cancelled: byStatus.get("CANCELLED")?._count._all ?? 0,
  };
}

export async function getPayoutDetail(businessId: string, payoutId: string) {
  const payout = await prisma.resellerPayout.findFirst({
    where: { id: payoutId, businessId },
    include: {
      reseller: { select: { id: true, name: true, code: true, phone: true, payoutAccountNumber: true, payoutAccountName: true } },
      entries: {
        include: {
          ledgerEntry: {
            include: { order: { select: { id: true, orderNumber: true, placedAt: true } } },
          },
        },
      },
      transactions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!payout) return null;

  const [requestedBy, approvedBy, paidBy] = await Promise.all([
    payout.requestedByUserId ? prisma.user.findUnique({ where: { id: payout.requestedByUserId }, select: { name: true } }) : null,
    payout.approvedByUserId ? prisma.user.findUnique({ where: { id: payout.approvedByUserId }, select: { name: true } }) : null,
    payout.paidByUserId ? prisma.user.findUnique({ where: { id: payout.paidByUserId }, select: { name: true } }) : null,
  ]);

  return { payout, requestedByName: requestedBy?.name ?? null, approvedByName: approvedBy?.name ?? null, paidByName: paidBy?.name ?? null };
}

/** Per-order earnings snapshot rows for the reseller dashboard. */
export async function resellerEarningsByOrder(businessId: string, resellerId: string, take = 50) {
  return prisma.resellerOrderEarning.findMany({
    where: { businessId, resellerId },
    orderBy: { createdAt: "desc" },
    take,
    include: { order: { select: { id: true, orderNumber: true, status: true, placedAt: true } } },
  });
}

/** Which reseller orders are delivered but still waiting for their settlement. */
export async function earningsAwaitingSettlement(businessId: string, resellerId: string) {
  return prisma.resellerOrderEarning.findMany({
    where: { businessId, resellerId, eligibilityStatus: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { order: { select: { id: true, orderNumber: true, status: true, deliveredAt: true } } },
    take: 100,
  });
}
