You are the senior full-stack engineer responsible for implementing my e-commerce and inventory management platform.

## First: inspect the existing project

* Inspect the repository structure, package manager, framework version, existing routes, UI components, database setup, authentication, and coding conventions.
* Follow the existing project structure. Do not replace working architecture or rewrite unrelated features.
* Identify existing functionality and reuse it where appropriate.
* Before making changes, provide a concise implementation plan and list any critical conflicts you discover.

## Business requirements

Build a single-business platform initially, with multiple storefronts/domains sharing the same catalog, customers, and inventory.

Use:

* Next.js and the project's existing framework conventions.
* PostgreSQL as the primary database.
* Prisma ORM.
* TypeScript.
* The existing UI component system, if present.
* S3-compatible object storage for future media features.

I already have a domain and VPS. Keep the deployment architecture appropriate for a budget below $25/month.

## Implement in this step

### 1. Application foundation

* Establish a clear modular structure for business logic, database access, validation, authorization, and UI.
* Configure environment variables and validate required configuration at startup.
* Add consistent error handling, logging, and API response conventions.
* Add database migrations and seed functionality.
* Do not put secrets in client-side code.

### 2. Authentication

* Implement secure email/password login for administrative users.
* Implement secure session creation, expiration, logout, and session validation.
* Hash passwords using a secure password-hashing algorithm.
* Protect management routes and APIs.
* Do not trust user-provided roles or IDs.
* Keep customer authentication extensible for later passwordless checkout/account claiming.

### 3. Roles and permissions

Implement granular permissions such as:

* product.view, product.create, product.update, product.delete
* inventory.view, inventory.adjust
* purchase.view, purchase.create, purchase.receive
* order.view, order.create, order.update, order.cancel
* customer.view, customer.update
* reseller.view, reseller.manage, reseller.payout
* user.manage, settings.manage, report.view

Requirements:

* Users can have multiple roles.
* Roles can contain multiple permissions.
* Enforce permissions on the server.
* Provide reusable authorization helpers.
* Protect the seed owner/admin from being deleted or demoted through the UI.
* Do not rely on frontend-only access control.

### 4. Database foundation

Create the initial Prisma schema and migrations for:

* Business
* Storefront and storefront domains
* User, Role, Permission, UserRole, RolePermission
* Customer and customer addresses
* Business and storefront settings
* Audit logs

Prepare the schema for products, variants, inventory, orders, resellers, media, and integrations in later steps.

### 5. Initial management UI

Create a modern responsive management layout with:

* Sidebar navigation
* Header and account menu
* Dashboard overview
* User/role/permission management
* Business and storefront settings

Use real database-backed data. Do not create mock functionality.

## Engineering requirements

* Validate all inputs on the server.
* Use transactions where multiple database writes must succeed together.
* Add useful empty, loading, success, and error states.
* Avoid `any` unless justified.
* Add tests for authentication, permissions, and critical database behavior.
* Do not hardcode credentials.
* Do not introduce unnecessary services or microservices.

## Completion criteria

1. Authentication and permissions work end to end.
2. Database migrations apply successfully.
3. Protected routes and APIs reject unauthorized access.
4. UI works on desktop and mobile.
5. Existing functionality remains intact.
6. Run lint, type checks, tests, and production build; fix failures.

At the end, report:

* What was implemented
* Important files changed
* Migrations and environment variables required
* Tests/build results
* Known limitations
* The next recommended implementation step

Do not begin Step 2 until this step is reviewed and working.
