import "server-only";
import { prisma } from "@/lib/db/client";
import { userDisplayNames } from "@/modules/users/queries";

/** Payment read queries: history, refunds queued for settlement, gateway attempts. */

export async function listPayments(
  businessId: string,
  query: { search?: string; method?: string; status?: string; page?: number; pageSize?: number; skip?: number; take?: number },
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? query.take ?? 25));
  const skip = query.skip ?? (page - 1) * pageSize;

  const where = {
    businessId,
    ...(query.method && query.method !== "ALL" ? { method: query.method as "COD" } : {}),
    ...(query.status && query.status !== "ALL" ? { status: query.status as "PAID" } : {}),
    ...(query.search
      ? {
          OR: [
            { providerReference: { contains: query.search, mode: "insensitive" as const } },
            { providerPaymentId: { contains: query.search, mode: "insensitive" as const } },
            { order: { orderNumber: { contains: query.search, mode: "insensitive" as const } } },
            { order: { customerPhoneNormalized: { contains: query.search } } },
            { order: { customerName: { contains: query.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total, aggregated] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        order: { select: { id: true, orderNumber: true, customerName: true, customerPhoneNormalized: true } },
        refunds: { select: { id: true, amountPaisa: true, status: true } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where, _sum: { amountPaisa: true, paidPaisa: true, refundedPaisa: true } }),
  ]);

  const names = await userDisplayNames(rows.flatMap((row) => [row.recordedByUserId, row.collectedByUserId]));

  return {
    rows: rows.map((row) => ({
      ...row,
      recordedByName: row.recordedByUserId ? (names.get(row.recordedByUserId) ?? null) : null,
      collectedByName: row.collectedByUserId ? (names.get(row.collectedByUserId) ?? null) : null,
    })),
    total,
    page,
    pageSize,
    paidPaisa: aggregated._sum.paidPaisa ?? 0,
    refundedPaisa: aggregated._sum.refundedPaisa ?? 0,
    outstandingPaisa: (aggregated._sum.amountPaisa ?? 0) - (aggregated._sum.paidPaisa ?? 0),
  };
}

export async function pendingRefunds(businessId: string) {
  const refunds = await prisma.refund.findMany({
    where: { businessId, status: { in: ["REQUESTED", "PROCESSING", "FAILED"] } },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: { order: { select: { id: true, orderNumber: true, customerName: true } }, payment: { select: { id: true, method: true, providerReference: true } } },
  });
  return refunds;
}

export async function paymentAttemptsForBusiness(businessId: string, take = 25) {
  return prisma.paymentAttempt.findMany({
    where: { payment: { businessId } },
    orderBy: { createdAt: "desc" },
    take,
    include: { payment: { select: { id: true, method: true, order: { select: { orderNumber: true } } } } },
  });
}

export async function paymentStats(businessId: string) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [today, byMethod, pendingRefundTotal] = await Promise.all([
    prisma.payment.aggregate({ where: { businessId, createdAt: { gte: dayStart } }, _sum: { paidPaisa: true }, _count: { _all: true } }),
    prisma.payment.groupBy({ by: ["method"], where: { businessId }, _sum: { paidPaisa: true } }),
    prisma.refund.aggregate({ where: { businessId, status: { in: ["REQUESTED", "PROCESSING"] } }, _sum: { amountPaisa: true }, _count: { _all: true } }),
  ]);

  return {
    todayPaisa: today._sum.paidPaisa ?? 0,
    todayCount: today._count._all,
    byMethod: byMethod.map((row) => ({ method: row.method, paidPaisa: row._sum.paidPaisa ?? 0 })),
    pendingRefundPaisa: pendingRefundTotal._sum.amountPaisa ?? 0,
    pendingRefundCount: pendingRefundTotal._count._all,
  };
}
