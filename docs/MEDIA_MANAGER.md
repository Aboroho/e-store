# Global Media Manager

The Media Manager is a platform capability, not part of the catalog or page builder.
`src/modules/media` owns storage, validation, authorization, upload lifecycle, browsing,
metadata and deletion. `src/components/media` owns all file controls and the shared picker.
Do not create another uploader or save signed URLs in business records.

## Using the shared components

```tsx
// Single image: associate the ID in the calling module's save transaction.
<MediaPicker onSelect={(asset) => setPrimaryImageId(asset.id)} />

// Gallery: confirmation returns the complete, ordered selection; cancel changes nothing.
<MediaPicker
  multiple
  maxSelection={50 - imageIds.length}
  excludeIds={imageIds}
  onConfirm={(assets) => setImageIds([...imageIds, ...assets.map(asset => asset.id)])}
/>

// A restricted document field. The caller must authorize its own business operation.
<MediaPicker
  mimeGroup="document"
  allowedTypes={["text/csv"]}
  uploadVisibility="PRIVATE"
  onSelect={(asset) => setSourceMediaId(asset.id)}
/>
```

Other options: `mimeGroup` (`image`, `video`, `document`, `all`), exact MIME types or
`image/*`/`video/*` in `allowedTypes`, `folderId` (fixed folder; `null` restricts to
root), `allowUpload`, `audience`, and a custom trigger. These are **UI constraints**,
not permission grants. Every association writer must validate asset IDs again.

The picker provides search, server-side pagination, folder navigation, grid/list views,
preview, drag/drop and file uploads, selection limits, and explicit confirm/cancel.
Uploading does not automatically associate a file. Canceling leaves an unused asset
in the library, so it can be selected later or cleaned up safely.

The main library at `/admin/media` additionally provides metadata/alt-text editing,
rename, move, explicit copy, multi-select and protected deletion. Copy is deliberately
a new asset/object; selecting an existing asset never copies it.

## Integrations

| Surface | Persistent reference |
| --- | --- |
| Product primary/gallery | Ordered `ProductImage.mediaId`; position zero is primary |
| Variant image / bulk attribute-value action | `VariantImage.mediaId` and synchronized `Variant.imageMediaId` |
| Attribute-value defaults | `AttributeValue.mediaId`; used when generating new combinations |
| Category | `Category.imageMediaId` |
| Business/brand logo | `Business.logoMediaId`, managed in business settings |
| Product description / page text blocks | `![alt text](media:UUID)` tokens |
| Page images, section backgrounds, banners, uploaded videos | Media IDs in validated page-version JSON |
| Page social sharing image | `Page.ogMediaId` |
| Customer reviews | `ReviewImage.mediaId`, restricted to that customer's uploads |
| Settlement CSV import source | `CourierSettlement.sourceMediaId`; uploads default to private |

There is no separate Brand entity in this repository: the product brand remains a
text label. Any future brand-logo editor must use the same picker and reference service.
External YouTube/Vimeo embeds remain provider IDs, not uploaded media.

Variant bulk image selection previews the affected variant names/SKUs for the selected
attribute value (or all variants). “Apply” changes form state; “Save product” commits
those validated associations. Clearing any image field only removes an association.

Rich text supports bold, italic, media insertion and preview. Images are inserted through
the picker as ID tokens, not HTML, base64, object URLs or expiring S3 URLs. React escapes
text and alt attributes; unsupported HTML/remote image syntax is displayed as text.
`/api/v1/media/{id}` resolves a ready asset to a fresh, short-lived storage URL, checking
permissions for private assets. Page/product saves validate all rich-text IDs.

## Upload and access controls

1. `requestUploadAction` authenticates, checks permissions and validates the declaration.
   Staff uploads require `media.manage`. Product/page/category/attribute/settings editors
   may browse public media without that upload permission. Customer requests are rate
   limited, image-only and constrained by the review size policy.
2. The service creates a `PENDING` row with a UUID-based object key and a short-lived
   presigned PUT. Filename extensions come from the MIME allowlist, not untrusted names.
3. `uploadMedia` is the **only** browser upload implementation. It reports byte progress,
   retries transient PUT failures up to three times against the same reservation and
   exposes failed-file retry in `MediaUpload`.
4. PUTs are immutable (`If-None-Match: *`) and bind the declared content length. A retry's
   412 is safe: confirmation still verifies the actual stored object's hash.
5. `confirmUploadAction` reauthorizes and verifies the uploader, actual size, declared
   storage content type (when available), file signature and server-computed SHA-256.
   Only then does the row become `READY`. Rejected bytes are deleted; failed deletions
   retain a tombstone for retry. Pending/rejected assets are never selectable or served
   by the ID resolver. The local development receiver also enforces limits while streaming.

Supported types: JPEG, PNG, WebP, AVIF, GIF, MP4, WebM, PDF, UTF-8 CSV. SVG, HTML,
executables and arbitrary binary files are not accepted. CSV is limited to 4 MB,
validated as UTF-8 without binary control characters, and parsed again by the importer.
There is a 64 MB hard ceiling; the per-business `media.max_upload_bytes` may be lower
(default 15 MB), and `media.allowed_types` may further narrow the allowlist. Existing
custom allowlists must explicitly enable newly supported CSV/video types.

Checksum reuse is limited to ready assets with matching business, owner scope, MIME,
size and visibility. Customer A cannot browse, confirm, reuse or attach customer B's
uploads. Customers cannot browse staff folders/media. Private CSV documents can be
selected/read by finance users with `courier.reconcile`; other non-media-manager staff
only browse public assets. Public content associations require public, ready media.

## Storage deployment

Production uploads require `STORAGE_DRIVER=s3`. Local filesystem storage is accepted
only for development/tests. Disabled storage refuses uploads rather than pretending to
succeed. Configure the existing `S3_*` environment values and run:

```sh
npm ci
npm run db:generate
npm run db:deploy
npm run build
```

Use a **private bucket** with public access blocked. All reads use signed GETs, including
public assets; public visibility grants access through the application's ID resolver,
not a public bucket ACL. `S3_PUBLIC_BASE_URL` is not used to bypass private access.
Keep credentials server-side. IAM needs GetObject, PutObject and DeleteObject for the
application's `businesses/*` prefix. Object listing is not required by normal workflows.

The S3-compatible provider must support SigV4, HEAD/GET/PUT/DELETE and conditional PUTs.
The endpoint must be reachable from both the server and the user's browser. Use HTTPS
in production; remote preview clients cannot reach a sandbox's localhost endpoint.
`next.config.ts` permits the configured storage origin in CSP, so rebuild when changing it.
Local-driver URLs are relative and therefore work behind the preview/reverse proxy.

Example bucket CORS (replace the origin with your actual storefront/admin origin;
include each authorized storefront origin and the precise preview origin when testing):

```json
[{
  "AllowedOrigins": ["https://shop.example.com"],
  "AllowedMethods": ["GET", "HEAD", "PUT"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag", "Content-Length"],
  "MaxAgeSeconds": 300
}]
```

CORS must allow `If-None-Match` and `Content-Type`. Do not make the bucket public to
solve a CORS problem. Presigned URLs are bearer links until their short expiry; revoking
application access does not invalidate an already issued S3 signature immediately.

## References, deletion and history

Use `replaceMediaReferences` **inside the caller's transaction**, together with the
actual business association. It checks business ownership, readiness, optional image/
public/customer restrictions, replaces only the specified field's references, and
recounts both old and new assets. Catalog helpers also validate the target entity.

Association writers and deletion take a transaction-scoped PostgreSQL advisory lock
per business. A concurrent attach cannot race past a delete. Deletion checks real join
rows and legacy direct fields (including user avatars and variant primary IDs), not
just the denormalized counter. It also checks retained page-version JSON, covering
legacy pages without usage rows. The former `force` option **cannot bypass these guards**.
Making an in-use public asset private is refused as well.

Page media usage includes every retained version, not only the latest draft. Removing
an image in a draft cannot break the published page or a later history restore. Delete
the page, or implement an explicitly authorized version-pruning workflow, before removing
files only referenced by its history. Product/variant/category edits never delete bytes.

## Cleanup and migration

The additive migrations preserve legacy completed media as `READY`, mark old pending
reservations `PENDING`, separate customer upload ownership, and add picker indexes and
the settlement source reference. Review pre-existing untrusted uploads before exposing
them; migration does not retroactively inspect old binary content. Legacy direct media
fields remain protected even without a `MediaUsage` row.

Cleanup is deliberately operator-driven and **dry-run by default**:

```sh
npm run media:cleanup -- --business BUSINESS_UUID --actor STAFF_UUID
# After reviewing the dry-run:
npm run media:cleanup -- --business BUSINESS_UUID --actor STAFF_UUID --apply
# Explicitly include READY files unused for at least 30 days:
npm run media:cleanup -- --business BUSINESS_UUID --actor STAFF_UUID --include-unused
npm run media:cleanup -- --business BUSINESS_UUID --actor STAFF_UUID --include-unused --apply
```

The CLI is a privileged maintenance tool for operators with database/storage access;
`--actor` identifies the staff audit identity in that business, not a browser permission
bypass. It considers pending/rejected reservations older than 24 hours, longer than the
maximum one-hour upload signature. Ready assets are excluded unless explicitly opted in.
All candidate deletions recheck references under the same lock. Storage failures remain
retryable tombstones and are marked `storagePurged` only after successful deletion.
Runs are bounded to 200 candidates plus 200 tombstones; repeat for large backlogs.

Keep DB records/tombstones for auditing. Never apply a bucket lifecycle rule deleting
all `businesses/*` objects by age: active shared assets may be old. Configure provider
cleanup for incomplete multipart uploads separately. Periodic bucket inventory may flag
objects absent from the DB after catastrophic DB restore/loss; review those manually
against backups before deletion.

## Verification

- `npm run check`: schema assembly, TypeScript and ESLint.
- `npm test`: unit and real PostgreSQL integration tests. Seed the development DB first
  (`npm run db:deploy && npm run db:seed`); existing auth/storefront tests need seed data.
- Media regression tests cover permissions, tenant/customer isolation, pending/rejected
  assets, signature/hash/size validation, immutable upload replay, S3 signing, network
  retries, folder/type/search filters, associations, retained versions, concurrent
  attach/delete, private CSV imports, explicit copy and cleanup.
- The architecture test rejects module-local file inputs, S3 clients and browser PUT
  implementations. New modules must extend the shared manager rather than bypass it.
- Browser smoke check: upload from product gallery picker, cancel without mutating form,
  select/confirm existing asset, save/reload product and switch the library to list view.

The development smoke test uses the local adapter. Run an additional upload/confirm/
preview/delete smoke test against your actual S3-compatible endpoint after configuring
its credentials and CORS; automated signing tests do not substitute for provider testing.
