import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { hashPassword } from "../../src/lib/auth/password";
import { PERMISSIONS, ROLE_TEMPLATES } from "../../src/lib/permissions/catalog";
import { slugify, normalizeBdPhone } from "../../src/lib/utils";
import { DISTRICTS } from "./districts";

/**
 * Idempotent seed.
 *
 * Safe to run repeatedly: rows are matched on their natural keys and updated
 * rather than duplicated. It never deletes business data. It creates:
 *   - the business, primary inventory location and default storefront;
 *   - the permission catalogue and the role templates;
 *   - the owner account (credentials from SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD);
 *   - districts, default delivery zones and exchange reasons;
 *   - an initial warehouse category tree used for warehouse organisation.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the database");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const OWNER_EMAIL = (process.env.SEED_OWNER_EMAIL ?? "owner@example.com").toLowerCase();
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "ChangeMe!2026";
const OWNER_NAME = process.env.SEED_OWNER_NAME ?? "Store Owner";
const BUSINESS_NAME = process.env.SEED_BUSINESS_NAME ?? "Demo Store";
const BUSINESS_PHONE = process.env.SEED_BUSINESS_PHONE ?? "+8801700000000";

async function seedPermissions() {
  let created = 0;
  let updated = 0;
  for (const permission of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { key: permission.key } });
    if (existing) {
      await prisma.permission.update({
        where: { key: permission.key },
        data: {
          group: permission.group,
          label: permission.label,
          description: permission.description ?? null,
          isDangerous: permission.isDangerous ?? false,
        },
      });
      updated += 1;
    } else {
      await prisma.permission.create({
        data: {
          key: permission.key,
          group: permission.group,
          label: permission.label,
          description: permission.description ?? null,
          isDangerous: permission.isDangerous ?? false,
        },
      });
      created += 1;
    }
  }
  console.log(`Permissions: ${created} created, ${updated} updated (${PERMISSIONS.length} total)`);
}

async function seedDistricts() {
  for (const district of DISTRICTS) {
    await prisma.district.upsert({
      where: { code: district.code },
      create: district,
      update: { name: district.name, division: district.division, isActive: true },
    });
  }
  console.log(`Districts: ${DISTRICTS.length} upserted`);
}

async function main() {
  console.log("Seeding platform reference data…");

  // ---------------------------------------------------------------- districts
  await seedDistricts();
  await seedPermissions();

  // ----------------------------------------------------------------- business
  const businessSlug = slugify(BUSINESS_NAME) || "business";
  const existingBusiness = await prisma.business.findFirst({ orderBy: { createdAt: "asc" } });
  const business = existingBusiness
    ? await prisma.business.update({
        where: { id: existingBusiness.id },
        data: { name: BUSINESS_NAME, legalName: BUSINESS_NAME, phone: BUSINESS_PHONE },
      })
    : await prisma.business.create({
        data: {
          name: BUSINESS_NAME,
          legalName: BUSINESS_NAME,
          slug: businessSlug,
          currency: "BDT",
          timezone: "Asia/Dhaka",
          locale: "en",
          phone: BUSINESS_PHONE,
        },
      });
  console.log(`Business: ${business.name} (${business.id})`);

  // --------------------------------------------------------------------- RBAC
  const allPermissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permissionIdByKey = new Map(allPermissions.map((permission) => [permission.key, permission.id]));

  for (const template of ROLE_TEMPLATES) {
    const keys = template.permissions === "*" ? allPermissions.map((permission) => permission.key) : template.permissions;
    const unknown = keys.filter((key) => !permissionIdByKey.has(key));
    if (unknown.length > 0) {
      throw new Error(`Role template "${template.slug}" references unknown permissions: ${unknown.join(", ")}`);
    }

    const role = await prisma.role.upsert({
      where: { businessId_slug: { businessId: business.id, slug: template.slug } },
      create: {
        businessId: business.id,
        name: template.name,
        slug: template.slug,
        description: template.description,
        isSystem: true,
        isProtected: template.isProtected ?? false,
      },
      update: {
        name: template.name,
        description: template.description,
        isSystem: true,
        isProtected: template.isProtected ?? false,
      },
    });

    // Keep the template permissions in sync without touching custom roles.
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: keys.map((key) => ({ roleId: role.id, permissionId: permissionIdByKey.get(key)! })),
        skipDuplicates: true,
      }),
    ]);
    console.log(`Role: ${role.name} — ${keys.length} permissions`);
  }

  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { businessId_slug: { businessId: business.id, slug: "owner" } },
  });

  // -------------------------------------------------------------------- owner
  const existingOwner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  const owner = existingOwner
    ? await prisma.user.update({
        where: { id: existingOwner.id },
        data: { name: OWNER_NAME, businessId: business.id, status: "ACTIVE", isOwner: true },
      })
    : await prisma.user.create({
        data: {
          businessId: business.id,
          name: OWNER_NAME,
          email: OWNER_EMAIL,
          status: "ACTIVE",
          isOwner: true,
          jobTitle: "Owner",
          passwordHash: await hashPassword(OWNER_PASSWORD),
        },
      });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: owner.id, roleId: ownerRole.id } },
    create: { userId: owner.id, roleId: ownerRole.id },
    update: {},
  });
  console.log(`Owner account: ${owner.email}`);

  // ------------------------------------------------------------- inventory site
  const location = await prisma.inventoryLocation.upsert({
    where: { businessId_code: { businessId: business.id, code: "MAIN" } },
    create: {
      businessId: business.id,
      name: "Main Warehouse",
      code: "MAIN",
      address: "Head office",
      isDefault: true,
      isActive: true,
    },
    update: { name: "Main Warehouse", isDefault: true, isActive: true },
  });
  console.log(`Inventory location: ${location.name}`);

  // -------------------------------------------------------------- pricing context
  // Catalog products need a default price list to hang prices on, so the seed
  // provides one; every storefront and channel resolves prices through it.
  const priceList = await prisma.priceList.upsert({
    where: { businessId_slug: { businessId: business.id, slug: "default" } },
    create: {
      businessId: business.id,
      name: "Default Price List",
      slug: "default",
      channel: "DEFAULT",
      currency: "BDT",
      isDefault: true,
      priority: 0,
      status: "ACTIVE",
      description: "Standard retail prices used when no channel specific list matches.",
    },
    update: { name: "Default Price List", isDefault: true, status: "ACTIVE" },
  });
  console.log(`Price list: ${priceList.name}`);

  // ------------------------------------------------------- stock adjustment reasons
  // Adjustments require a configured reason; the direction and note rules are
  // enforced by the inventory service.
  const adjustmentReasons = [
    { code: "OPENING_BALANCE", label: "Opening balance", direction: "INCREASE", requiresNote: false },
    { code: "STOCK_COUNT", label: "Stock count correction", direction: "BOTH", requiresNote: true },
    { code: "DAMAGE", label: "Damaged in warehouse", direction: "DECREASE", requiresNote: true },
    { code: "LOST", label: "Lost or missing", direction: "DECREASE", requiresNote: true },
    { code: "FOUND", label: "Found stock", direction: "INCREASE", requiresNote: true },
    { code: "RETURN_RESTOCK", label: "Customer return restocked", direction: "INCREASE", requiresNote: false },
    { code: "SAMPLE", label: "Sample or giveaway", direction: "DECREASE", requiresNote: true },
    { code: "WRITE_OFF", label: "Write-off", direction: "DECREASE", requiresNote: true },
  ] as const;
  for (const reason of adjustmentReasons) {
    await prisma.stockAdjustmentReason.upsert({
      where: { businessId_code: { businessId: business.id, code: reason.code } },
      create: { businessId: business.id, ...reason, isActive: true },
      update: { label: reason.label, direction: reason.direction, requiresNote: reason.requiresNote, isActive: true },
    });
  }
  console.log(`Stock adjustment reasons: ${adjustmentReasons.length}`);

  // ------------------------------------------------------------------ storefront
  const storefront = await prisma.storefront.upsert({
    where: { slug: "main" },
    create: {
      businessId: business.id,
      name: `${BUSINESS_NAME} Online`,
      slug: "main",
      code: "MAIN",
      status: "ACTIVE",
      isDefault: true,
      defaultCurrency: "BDT",
      defaultLocationId: location.id,
      supportPhone: BUSINESS_PHONE,
      allowedPaymentMethods: ["COD"],
      allowedCourierProviders: ["MANUAL"],
      codEnabled: true,
      preorderEnabled: true,
    },
    update: {
      name: `${BUSINESS_NAME} Online`,
      status: "ACTIVE",
      isDefault: true,
      defaultLocationId: location.id,
    },
  });
  console.log(`Storefront: ${storefront.name} (${storefront.slug})`);

  // ------------------------------------------------- delivery zones (seed fees)
  const zoneFees: Record<string, number> = { "01": 6000, "11": 8000, "43": 12000 };
  for (const district of DISTRICTS) {
    const feePaisa = zoneFees[district.code] ?? 12000;
    await prisma.deliveryZone.upsert({
      where: {
        businessId_storefrontId_districtCode: {
          businessId: business.id,
          storefrontId: storefront.id,
          districtCode: district.code,
        },
      },
      create: {
        businessId: business.id,
        storefrontId: storefront.id,
        districtCode: district.code,
        feePaisa,
        codEnabled: true,
        estimatedDaysMin: feePaisa <= 6000 ? 1 : feePaisa <= 8000 ? 1 : 2,
        estimatedDaysMax: feePaisa <= 6000 ? 2 : feePaisa <= 8000 ? 3 : 4,
      },
      update: { feePaisa },
    });
  }
  console.log(`Delivery zones: ${DISTRICTS.length} upserted for ${storefront.name}`);

  // ----------------------------------------------------------- exchange reasons
  const reasons = [
    { code: "DAMAGED", label: "Item arrived damaged", deliveryChargePaisa: 0, requiresNote: true },
    { code: "WRONG_ITEM", label: "Wrong item delivered", deliveryChargePaisa: 0, requiresNote: true },
    { code: "DEFECTIVE", label: "Defective on arrival", deliveryChargePaisa: 0, requiresNote: true },
    { code: "SIZE_ISSUE", label: "Size does not fit", deliveryChargePaisa: 0, requiresNote: false },
    { code: "CHANGED_MIND", label: "Customer changed their mind", deliveryChargePaisa: 12000, requiresNote: false },
  ];
  for (const [index, reason] of reasons.entries()) {
    await prisma.exchangeReason.upsert({
      where: { businessId_code: { businessId: business.id, code: reason.code } },
      create: {
        businessId: business.id,
        code: reason.code,
        label: reason.label,
        deliveryChargePaisa: reason.deliveryChargePaisa,
        requiresNote: reason.requiresNote,
        requiresApproval: true,
        position: index,
      },
      update: { label: reason.label, deliveryChargePaisa: reason.deliveryChargePaisa, position: index },
    });
  }
  console.log(`Exchange reasons: ${reasons.length} upserted`);

  // ------------------------------------------------------------ document numbers
  const sequences = [
    { key: "order", prefix: "ORD" },
    { key: "purchase_order", prefix: "PO" },
    { key: "goods_receipt", prefix: "GRN" },
    { key: "shipment", prefix: "SHP" },
    { key: "exchange", prefix: "EX" },
    { key: "reseller_payout", prefix: "PAY" },
    { key: "invoice", prefix: "INV" },
  ];
  for (const sequence of sequences) {
    await prisma.numberSequence.upsert({
      where: { businessId_key_scope: { businessId: business.id, key: sequence.key, scope: "" } },
      create: { businessId: business.id, key: sequence.key, scope: "", prefix: sequence.prefix, padding: 5 },
      update: {},
    });
  }
  console.log(`Number sequences: ${sequences.length} ready`);

  // ------------------------------------------------------- courier providers
  const courierProvider = await prisma.courierProvider.upsert({
    where: { businessId_code: { businessId: business.id, code: "MANUAL" } },
    create: {
      businessId: business.id,
      code: "MANUAL",
      name: "Manual / own delivery",
      isEnabled: true,
      testMode: false,
      codEnabled: true,
    },
    update: { isEnabled: true },
  });
  console.log(`Courier provider: ${courierProvider.name}`);

  // ------------------------------------------------------------------ sanity
  if (OWNER_PASSWORD === "ChangeMe!2026") {
    console.log("\n⚠  Seeded with the default owner password. Set SEED_OWNER_PASSWORD before any real deployment.");
  }
  const normalizedPhone = normalizeBdPhone(BUSINESS_PHONE);
  if (!normalizedPhone) {
    console.warn("⚠  SEED_BUSINESS_PHONE is not a valid Bangladesh phone number.");
  }
  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
