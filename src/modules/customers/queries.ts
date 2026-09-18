import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { parseListQuery } from "@/lib/validation";

const CUSTOMER_SORT_COLUMNS = { createdAt: "createdAt", name: "name", totalSpentPaisa: "totalSpentPaisa", lastOrderAt: "lastOrderAt" } as const;

/** Admin customer list with order counts and lifetime value. */
export async function listCustomers(
  businessId: string,
  params: Record<string, string | string[] | undefined>,
) {
  const query = parseListQuery(params, { allowedSortBy: ["createdAt", "name", "totalSpentPaisa", "lastOrderAt"] });
  const status = typeof params.status === "string" && params.status !== "ALL" ? params.status : undefined;

  const where: Prisma.CustomerWhereInput = {
    businessId,
    deletedAt: null,
    ...(status ? { status: status as "ACTIVE" | "BLOCKED" } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { phoneNormalized: { contains: query.search } },
            { email: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { [CUSTOMER_SORT_COLUMNS[(query.sortBy ?? "createdAt") as keyof typeof CUSTOMER_SORT_COLUMNS] ?? "createdAt"]: query.sortDir },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        phoneNormalized: true,
        email: true,
        status: true,
        hasAccount: true,
        totalOrders: true,
        totalSpentPaisa: true,
        lastOrderAt: true,
        createdAt: true,
        districtCode: true,
      },
    }),
    prisma.customer.count({ where }),
  ]);

  return { rows, total, page: query.page, pageSize: query.pageSize, search: query.search, sortBy: query.sortBy, sortDir: query.sortDir };
}

/** Customers matching a phone number across storefronts (identity is per business). */
export async function findCustomersByPhone(businessId: string, phoneNormalized: string) {
  return prisma.customer.findMany({ where: { businessId, phoneNormalized }, orderBy: { createdAt: "asc" } });
}

export async function customerStats(businessId: string) {
  const [total, withAccount, blocked, aggregated] = await Promise.all([
    prisma.customer.count({ where: { businessId, deletedAt: null } }),
    prisma.customer.count({ where: { businessId, deletedAt: null, hasAccount: true } }),
    prisma.customer.count({ where: { businessId, deletedAt: null, status: "BLOCKED" } }),
    prisma.customer.aggregate({ where: { businessId, deletedAt: null }, _sum: { totalSpentPaisa: true, totalOrders: true } }),
  ]);

  return {
    total,
    withAccount,
    blocked,
    totalSpentPaisa: aggregated._sum?.totalSpentPaisa ?? 0,
    totalOrders: aggregated._sum?.totalOrders ?? 0,
  };
}
