Continue my e-commerce and inventory management platform. Steps 1–4 should already be complete.

Inspect the existing codebase and verify the previous features before starting. Preserve all existing functionality and reuse the established catalog, pricing, checkout, order, customer, permission, and storage services.

## Goal

Complete the storefront experience, CMS/page builder, media manager, external APIs, marketing integrations, and production deployment preparation.

## 1. Public storefronts

Implement multiple storefronts/domains for the same business.

Requirements:

* Shared product catalog, customers, and inventory.
* Storefront-specific theme, navigation, pages, and settings.
* Product listing and detail pages.
* Variant selection and stock/preorder indicators.
* Cart and checkout.
* Customer account and order history.
* Responsive layout and accessible interactions.
* Server-rendered or otherwise optimized product pages.
* SEO metadata, canonical URLs, sitemap, and robots configuration.

Use the existing order and inventory services. Never create a separate storefront-only stock system.

## 2. Drag-and-drop page builder

Implement an Elementor-like page builder with:

* Widget palette
* Drag-and-drop canvas
* Section/container layout
* Text, image, button, product grid, featured product, banner, and other trusted widgets
* Desktop/tablet/mobile responsive controls
* Preview and publishing workflow
* Drafts and version history

Store page layouts as validated JSON.

Render only trusted, registered components. Do not execute arbitrary JavaScript, JSX, or HTML from database content.

## 3. Media manager

Implement an S3-compatible media manager with:

* Upload and drag/drop
* Folder creation
* Move and copy
* Rename
* Delete with reference checks
* Search and filtering
* Image preview and metadata
* Reusable media selection for products, variants, pages, and reviews

Use private storage where appropriate and generate safe, time-limited upload/download URLs.

Do not expose storage credentials to the browser.

## 4. Customer reviews

Implement:

* One review per customer per purchased product.
* Purchase verification.
* Rating, title, and body.
* Up to 3 images.
* 50 MB combined image upload limit by default.
* Moderation and review status.
* Report/review management UI.

Enforce image count and size on the server.

## 5. API keys and webhooks

Implement scoped API keys for authorized integrations.

Requirements:

* Generate secrets securely.
* Store only hashes.
* Display the secret only once.
* Support expiration, revocation, and last-used tracking.
* Enforce scopes on every request.
* Rate limiting and input validation.
* Webhook subscriptions with retry and delivery logs.
* Idempotency support.

Expose only the product/order data required by the granted scopes.

## 6. Marketing integrations

Implement configurable marketing integrations for Meta Pixel and server-side conversion events, with an extensible provider architecture.

Requirements:

* Store configuration securely.
* Support storefront-specific settings.
* Provide event delivery logs and retries.
* Respect applicable consent and opt-out settings.
* Avoid sending unnecessary personal data.
* Prevent duplicate event delivery where provider APIs support deduplication.
* Never expose server-side credentials in client code.

## 7. Plugin architecture

Prepare a safe plugin registry and installation/configuration interface.

For v1:

* Support trusted, explicitly registered extensions.
* Store plugin metadata, version, configuration, and enabled status.
* Enforce permissions and compatibility checks.
* Do not execute arbitrary third-party code uploaded through the admin interface.

Keep a public plugin marketplace as a future extension, not a requirement to execute untrusted plugins now.

## 8. Production readiness

Prepare the application for deployment on my existing domain and VPS with a budget below $25/month.

Implement or document:

* Production environment configuration
* Database migrations and backup/restore process
* S3-compatible storage configuration
* Secure cookies and HTTPS assumptions
* Reverse proxy configuration
* Background worker deployment
* Logging and error monitoring
* Rate limiting
* Health checks
* Database connection management
* Security headers
* Dependency and secret checks
* Recovery procedure

Do not hardcode domain names, credentials, or provider secrets.

## 9. Final end-to-end testing

Test:

* Product publication to storefront
* Variant pricing and stock display
* Checkout and order creation
* Customer account claim and login
* Order cancellation
* Courier updates
* Exchange workflow
* Reseller payout eligibility
* Media upload and reuse
* Page builder publishing
* API key scopes and revocation
* Marketing event delivery
* Responsive UI and authorization

Run lint, type checks, tests, and production build. Fix failures before reporting completion.

## Final report

Provide:

1. Features completed.
2. Important files and modules.
3. Database migrations.
4. Required environment variables.
5. Deployment instructions for my VPS/domain.
6. Backup and restore instructions.
7. Test and build results.
8. Known limitations and security considerations.
9. Recommended post-v1 improvements.

Do not claim production readiness unless the implementation, tests, security checks, and deployment configuration have actually been verified.
