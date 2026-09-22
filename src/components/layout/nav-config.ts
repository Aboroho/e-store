/**
 * Admin navigation model.
 *
 * Every entry declares the permission required to see it; the layout filters
 * the menu per signed-in user. Hiding an entry is a usability aid only —
 * the matching pages and actions enforce the same permission server-side.
 */
export interface NavItem {
  label: string;
  href: string;
  permission: string;
  icon: string;
  badge?: "orders" | "exchanges" | "preorders" | "notifications";
  /**
   * Stage that implements this screen. Items whose stage has not shipped yet are
   * rendered as disabled with a "Stage N" hint instead of linking to a 404.
   * Keep this in sync with docs/IMPLEMENTATION_PLAN.md.
   */
  stage: number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const ADMIN_NAV: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/admin", permission: "dashboard.view", icon: "LayoutDashboard", stage: 1 },
      { label: "Reports", href: "/admin/reports", permission: "report.view", icon: "BarChart3", stage: 4 },
    ],
  },
  {
    title: "Catalog",
    items: [
      { label: "Products", href: "/admin/catalog/products", permission: "product.view", icon: "Package", stage: 2 },
      { label: "Categories", href: "/admin/catalog/categories", permission: "product.view", icon: "FolderTree", stage: 2 },
      { label: "Attributes", href: "/admin/catalog/attributes", permission: "product.view", icon: "Palette", stage: 2 },
      { label: "Brands", href: "/admin/catalog/brands", permission: "product.view", icon: "Bookmark", stage: 2 },
      { label: "Price lists", href: "/admin/catalog/price-lists", permission: "pricing.manage", icon: "Tags", stage: 2 },
      { label: "Tax rates", href: "/admin/catalog/tax-rates", permission: "product.view", icon: "Percent", stage: 2 },
      { label: "Packaging costs", href: "/admin/catalog/packaging-costs", permission: "product.view", icon: "Box", stage: 2 },
      { label: "Unit labels", href: "/admin/catalog/unit-labels", permission: "product.view", icon: "Scale", stage: 2 },
    ],
  },
  {
    title: "Stock",
    items: [
      { label: "Inventory", href: "/admin/inventory", permission: "inventory.view", icon: "Boxes", stage: 2 },
      { label: "Adjustments", href: "/admin/inventory/adjustments", permission: "inventory.adjust", icon: "SlidersHorizontal", stage: 2 },
      { label: "Preorders", href: "/admin/inventory/preorders", permission: "preorder.view", icon: "Clock", badge: "preorders", stage: 2 },
      { label: "Purchases", href: "/admin/purchasing", permission: "purchase.view", icon: "Truck", stage: 2 },
      { label: "Suppliers", href: "/admin/purchasing/suppliers", permission: "purchase.view", icon: "Factory", stage: 2 },
    ],
  },
  {
    title: "Sales",
    items: [
      { label: "Orders", href: "/admin/orders", permission: "order.view", icon: "ShoppingCart", badge: "orders", stage: 3 },
      { label: "Customers", href: "/admin/customers", permission: "customer.view", icon: "Users", stage: 3 },
      { label: "Payments", href: "/admin/payments", permission: "payment.view", icon: "CreditCard", stage: 3 },
      { label: "Shipments", href: "/admin/shipments", permission: "courier.view", icon: "Send", stage: 3 },
      { label: "Couriers & gateways", href: "/admin/couriers", permission: "courier.view", icon: "Plug", stage: 3 },
      { label: "Exchanges", href: "/admin/exchanges", permission: "exchange.view", icon: "RefreshCw", badge: "exchanges", stage: 3 },
    ],
  },
  {
    title: "Resellers",
    items: [
      { label: "Resellers", href: "/admin/resellers", permission: "reseller.view", icon: "Store", stage: 4 },
      { label: "Payouts", href: "/admin/payouts", permission: "reseller.payout", icon: "Banknote", stage: 4 },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Courier settlements", href: "/admin/settlements", permission: "courier.view", icon: "Landmark", stage: 3 },
      { label: "Reconciliation issues", href: "/admin/settlements?status=DISPUTED", permission: "courier.reconcile", icon: "AlertTriangle", stage: 4 },
    ],
  },
  {
    title: "Storefront",
    items: [
      { label: "Storefronts", href: "/admin/storefronts", permission: "storefront.manage", icon: "Globe", stage: 5 },
      { label: "Pages", href: "/admin/pages", permission: "page.manage", icon: "FileText", stage: 5 },
      // Stage 4: the Media Library page is live, so the entry is enabled — it is
      // the standalone way into the media manager, with no upload field needed.
      { label: "Media", href: "/admin/media", permission: "media.manage", icon: "Image", stage: 4 },
      { label: "Reviews", href: "/admin/reviews", permission: "review.moderate", icon: "Star", stage: 5 },
    ],
  },
  {
    title: "Platform",
    items: [
      { label: "Notifications", href: "/admin/notifications", permission: "notification.view", icon: "Bell", badge: "notifications", stage: 1 },
      { label: "Integrations", href: "/admin/integrations", permission: "integration.manage", icon: "Plug", stage: 5 },
      { label: "API keys", href: "/admin/api-keys", permission: "api_key.manage", icon: "KeyRound", stage: 5 },
      { label: "Plugins", href: "/admin/plugins", permission: "plugin.manage", icon: "Puzzle", stage: 5 },
      { label: "Background jobs", href: "/admin/jobs", permission: "job.manage", icon: "Activity", stage: 5 },
      { label: "Audit log", href: "/admin/audit", permission: "audit.view", icon: "ScrollText", stage: 1 },
      { label: "Users", href: "/admin/users", permission: "user.manage", icon: "UserCog", stage: 1 },
      { label: "Roles", href: "/admin/roles", permission: "role.manage", icon: "ShieldCheck", stage: 1 },
      { label: "Settings", href: "/admin/settings", permission: "settings.manage", icon: "Settings", stage: 1 },
    ],
  },
];
