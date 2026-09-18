import "server-only";
import { prisma } from "@/lib/db/client";

/** District list for pickers (delivery zones, customer addresses, checkout). */
export async function listDistricts() {
  return prisma.district.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { code: true, name: true, division: true } });
}

export async function listStorefronts(businessId: string) {
  return prisma.storefront.findMany({
    where: { businessId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, status: true, isDefault: true },
  });
}

export async function listDeliveryZones(businessId: string) {
  return prisma.deliveryZone.findMany({
    where: { businessId },
    orderBy: [{ districtCode: "asc" }],
    include: { storefront: { select: { name: true } }, district: { select: { name: true } } },
  });
}
