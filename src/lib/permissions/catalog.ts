/**
 * Permission catalogue.
 *
 * Permission keys are stable identifiers used by the API, server actions and
 * the UI. They are seeded into the database (Permission table) and assigned to
 * roles; the source of truth for the code that exists is this file.
 */

export interface PermissionDefinition {
  key: string;
  group: string;
  label: string;
  description?: string;
  /** Dangerous permissions are highlighted in the UI and never granted by default. */
  isDangerous?: boolean;
}

export const PERMISSIONS: PermissionDefinition[] = [
  // Dashboard & reports
  { key: "dashboard.view", group: "Dashboard", label: "View dashboard" },
  { key: "report.view", group: "Reports", label: "View reports" },
  { key: "report.export", group: "Reports", label: "Export reports", isDangerous: true },
  { key: "report.view_cost", group: "Reports", label: "View cost and margin data", isDangerous: true },

  // Catalog
  { key: "product.view", group: "Catalog", label: "View products" },
  { key: "product.create", group: "Catalog", label: "Create products" },
  { key: "product.update", group: "Catalog", label: "Edit products and variants" },
  { key: "product.delete", group: "Catalog", label: "Archive/delete products", isDangerous: true },
  { key: "product.view_cost", group: "Catalog", label: "View purchase cost", isDangerous: true },
  { key: "category.manage", group: "Catalog", label: "Manage categories" },
  { key: "attribute.manage", group: "Catalog", label: "Manage attributes and presets" },
  { key: "pricing.manage", group: "Catalog", label: "Manage price lists and prices", isDangerous: true },

  // Inventory
  { key: "inventory.view", group: "Inventory", label: "View inventory" },
  { key: "inventory.adjust", group: "Inventory", label: "Adjust stock", isDangerous: true },
  { key: "inventory.count", group: "Inventory", label: "Record stock counts" },
  { key: "inventory.view_cost", group: "Inventory", label: "View inventory cost and valuation", isDangerous: true },
  { key: "preorder.view", group: "Inventory", label: "View preorders" },
  { key: "preorder.allocate", group: "Inventory", label: "Allocate preorders" },

  // Purchasing
  { key: "purchase.view", group: "Purchasing", label: "View purchases" },
  { key: "purchase.create", group: "Purchasing", label: "Create purchase orders" },
  { key: "purchase.receive", group: "Purchasing", label: "Receive stock against purchases", isDangerous: true },
  { key: "purchase.cancel", group: "Purchasing", label: "Cancel purchase orders", isDangerous: true },
  { key: "supplier.manage", group: "Purchasing", label: "Manage suppliers" },

  // Orders
  { key: "order.view", group: "Orders", label: "View orders" },
  { key: "order.create", group: "Orders", label: "Create orders" },
  { key: "order.update", group: "Orders", label: "Edit orders" },
  { key: "order.cancel", group: "Orders", label: "Cancel orders", isDangerous: true },
  { key: "order.adjust", group: "Orders", label: "Apply order adjustments (discounts/charges)", isDangerous: true },
  { key: "order.dispatch", group: "Orders", label: "Dispatch orders" },
  { key: "order.deliver", group: "Orders", label: "Mark orders delivered" },
  { key: "order.view_cost", group: "Orders", label: "View order cost and profit", isDangerous: true },

  // Customers
  { key: "customer.view", group: "Customers", label: "View customers" },
  { key: "customer.update", group: "Customers", label: "Edit customers" },
  { key: "customer.delete", group: "Customers", label: "Delete/merge customers", isDangerous: true },
  { key: "customer.view_pii", group: "Customers", label: "View full customer contact details" },

  // Payments
  { key: "payment.view", group: "Payments", label: "View payments" },
  { key: "payment.record", group: "Payments", label: "Record manual payments" },
  { key: "payment.refund", group: "Payments", label: "Process refunds", isDangerous: true },
  { key: "payment.reconcile", group: "Payments", label: "Reconcile payments", isDangerous: true },

  // Couriers
  { key: "courier.view", group: "Couriers", label: "View shipments" },
  { key: "courier.manage", group: "Couriers", label: "Create shipments and manage courier settings" },
  { key: "courier.reconcile", group: "Couriers", label: "Reconcile courier settlements", isDangerous: true },

  // Exchanges
  { key: "exchange.view", group: "Exchanges", label: "View exchanges" },
  { key: "exchange.create", group: "Exchanges", label: "Create exchange requests" },
  { key: "exchange.approve", group: "Exchanges", label: "Approve exchanges", isDangerous: true },
  { key: "exchange.inspect", group: "Exchanges", label: "Inspect returned items" },

  // Resellers
  { key: "reseller.view", group: "Resellers", label: "View resellers" },
  { key: "reseller.manage", group: "Resellers", label: "Manage resellers and pricing", isDangerous: true },
  { key: "reseller.payout", group: "Resellers", label: "Create and process reseller payouts", isDangerous: true },
  { key: "reseller.ledger_view", group: "Resellers", label: "View reseller ledger and balances" },

  // Storefront & content
  { key: "storefront.manage", group: "Content", label: "Manage storefronts and domains", isDangerous: true },
  { key: "page.manage", group: "Content", label: "Manage pages and the page builder" },
  { key: "media.manage", group: "Content", label: "Manage media library" },
  { key: "media.upload", group: "Content", label: "Upload to the media library" },
  { key: "navigation.manage", group: "Content", label: "Manage navigation menus" },
  { key: "review.moderate", group: "Content", label: "Moderate reviews" },

  // Platform administration
  { key: "user.manage", group: "Administration", label: "Manage users", isDangerous: true },
  { key: "role.manage", group: "Administration", label: "Manage roles and permissions", isDangerous: true },
  { key: "settings.manage", group: "Administration", label: "Manage business settings", isDangerous: true },
  { key: "integration.manage", group: "Administration", label: "Manage integrations and credentials", isDangerous: true },
  { key: "api_key.manage", group: "Administration", label: "Manage API keys", isDangerous: true },
  { key: "plugin.manage", group: "Administration", label: "Manage plugins", isDangerous: true },
  { key: "audit.view", group: "Administration", label: "View audit log" },
  { key: "job.manage", group: "Administration", label: "Manage background jobs" },
  { key: "notification.view", group: "Administration", label: "View notifications" },
];

export const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);

export function permissionsByGroup(): Record<string, PermissionDefinition[]> {
  return PERMISSIONS.reduce<Record<string, PermissionDefinition[]>>((groups, permission) => {
    (groups[permission.group] ??= []).push(permission);
    return groups;
  }, {});
}

/** Role templates used when seeding a fresh installation. */
export interface RoleTemplate {
  slug: string;
  name: string;
  description: string;
  isProtected?: boolean;
  permissions: string[] | "*";
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    slug: "owner",
    name: "Owner",
    description: "Full access to every part of the platform. Cannot be deleted or demoted.",
    isProtected: true,
    permissions: "*",
  },
  {
    slug: "admin",
    name: "Administrator",
    description: "Everyday management of catalog, orders, inventory, customers and content.",
    permissions: PERMISSION_KEYS.filter(
      (key) => !["user.manage", "role.manage", "integration.manage", "api_key.manage", "plugin.manage"].includes(key),
    ),
  },
  {
    slug: "inventory-staff",
    name: "Inventory staff",
    description: "Catalog upkeep, purchasing, receiving and stock control.",
    permissions: [
      "dashboard.view",
      "product.view",
      "product.create",
      "product.update",
      "category.manage",
      "attribute.manage",
      "media.upload",
      "inventory.view",
      "inventory.adjust",
      "inventory.count",
      "inventory.view_cost",
      "preorder.view",
      "preorder.allocate",
      "purchase.view",
      "purchase.create",
      "purchase.receive",
      "supplier.manage",
      "report.view",
      "notification.view",
    ],
  },
  {
    slug: "order-staff",
    name: "Order staff",
    description: "Order processing, packing and dispatching.",
    permissions: [
      "dashboard.view",
      "product.view",
      "inventory.view",
      "order.view",
      "order.create",
      "order.update",
      "order.dispatch",
      "order.deliver",
      "customer.view",
      "courier.view",
      "courier.manage",
      "exchange.view",
      "exchange.create",
      "payment.view",
      "notification.view",
    ],
  },
  {
    slug: "customer-support",
    name: "Customer support",
    description: "Customer records, orders, exchanges and reviews.",
    permissions: [
      "dashboard.view",
      "product.view",
      "order.view",
      "order.update",
      "order.cancel",
      "customer.view",
      "customer.update",
      "customer.view_pii",
      "exchange.view",
      "exchange.create",
      "review.moderate",
      "payment.view",
      "courier.view",
      "notification.view",
    ],
  },
  {
    slug: "finance",
    name: "Finance",
    description: "Payments, refunds, settlements, reseller balances and financial reporting.",
    permissions: [
      "dashboard.view",
      "order.view",
      "order.view_cost",
      "payment.view",
      "payment.record",
      "payment.refund",
      "payment.reconcile",
      "courier.view",
      "courier.reconcile",
      "reseller.view",
      "reseller.ledger_view",
      "reseller.payout",
      "report.view",
      "report.export",
      "report.view_cost",
      "inventory.view",
      "inventory.view_cost",
      "audit.view",
      "notification.view",
    ],
  },
  {
    slug: "reseller",
    name: "Reseller",
    description: "Reseller portal access. Staff accounts should not use this role.",
    permissions: [
      "dashboard.view",
      "product.view",
      "inventory.view",
      "order.view",
      "order.create",
      "reseller.ledger_view",
      "notification.view",
    ],
  },
];

/** The permission required to view a given admin section. */
export const NAV_PERMISSIONS: Record<string, string> = {
  dashboard: "dashboard.view",
  catalog: "product.view",
  inventory: "inventory.view",
  purchasing: "purchase.view",
  orders: "order.view",
  customers: "customer.view",
  payments: "payment.view",
  couriers: "courier.view",
  exchanges: "exchange.view",
  resellers: "reseller.view",
  settlements: "courier.reconcile",
  finance: "report.view",
  reports: "report.view",
  resellers_payouts: "reseller.payout",
  storefront: "storefront.manage",
  pages: "page.manage",
  media: "media.manage",
  reviews: "review.moderate",
  integrations: "integration.manage",
  api: "api_key.manage",
  plugins: "plugin.manage",
  notifications: "notification.view",
  users: "user.manage",
  roles: "role.manage",
  settings: "settings.manage",
  audit: "audit.view",
  jobs: "job.manage",
};
