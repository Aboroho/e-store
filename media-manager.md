# FULL-FLEDGED CENTRALIZED MEDIA MANAGER — MANDATORY

The application already has an existing Media Manager, but its current UI/UX and functionality are inadequate.

**Do not treat the existing Media Manager as sufficient. Redesign and refactor it into a complete, production-ready, WordPress-like Media Manager with a modern, polished, highly usable interface and robust functionality.**

The goal is to create **one centralized, reusable Media Manager** that can serve the entire application.

This is a shared platform capability—not a feature belonging to products, pages, the page builder, the rich-text editor, or any individual module.

---

# 1. CORE PRINCIPLE — ONE CENTRALIZED MEDIA SYSTEM

There must be exactly **one source of truth for media assets**.

All media-consuming features must use the same:

* Media Library
* Media Picker
* Upload system
* Storage abstraction
* Media database records
* Permission system
* File validation
* Preview system
* Media metadata system
* Media reference/lifecycle system

Do not create separate uploaders for different modules.

Do not create separate media libraries.

Do not create module-specific S3 upload implementations.

Do not duplicate the same media file merely because it is being used in multiple places.

The Media Manager should behave as a reusable platform service that any future feature can consume.

---

# 2. COMPLETE WORDPRESS-LIKE MEDIA LIBRARY

Redesign the existing Media Manager into a full-featured media library.

The experience should feel comparable to a mature CMS such as WordPress, while still following the application's existing design system.

The interface should be:

* Modern
* Clean
* Fast
* Responsive
* Intuitive
* Visually polished
* Consistent with the existing application
* Suitable for large media libraries
* Optimized for both mouse and keyboard users

Do not simply add buttons to the existing UI.

**Rework the Media Manager UI/UX where necessary so the complete workflow feels intentional and cohesive.**

---

# 3. MEDIA LIBRARY LAYOUT

The main Media Library should provide a clear information hierarchy.

Recommended structure:

### Header

Include:

* Page title
* Search
* Upload button
* Create Folder button
* View mode toggle
* Filter controls
* Optional sort controls
* Bulk-selection actions when items are selected

### Main content

Support:

* Folder navigation
* Breadcrumb navigation
* Media grid
* Media list/table
* Empty states
* Loading states
* Error states
* Pagination or virtualization where appropriate

### Details / Preview panel

When a media item is selected, provide a polished details panel or modal containing:

* Large preview
* Filename
* File type
* File size
* Dimensions
* Upload date
* Modified date
* Folder
* Alt text
* Title
* Caption, if supported
* Description, if supported
* MIME type
* Storage/reference information where appropriate
* Usage information
* Actions

Do not expose unnecessary internal storage details to ordinary users.

---

# 4. UPLOAD EXPERIENCE — MUST BE FIRST-CLASS

The current Media Manager does not provide adequate uploading functionality.

This must be completely redesigned.

## 4.1 Drag-and-drop upload

Users must be able to drag files directly into the Media Library.

Provide a clear visual drop zone when files are being dragged over the application.

For example:

> Drop files here to upload

The UI should clearly indicate that the application is ready to accept files.

Support:

* Single-file uploads
* Multiple-file uploads
* Folder-aware uploads where technically supported
* Dragging files into a specific folder
* Dragging files onto the library

After dropping files:

* Immediately show upload items
* Display progress
* Display success/failure state
* Show validation errors
* Allow retrying failed uploads
* Do not freeze the interface

---

# 5. CLICK-TO-UPLOAD

There must always be an obvious:

**Upload Media**

button.

Clicking it should open the native file picker.

Support selecting:

* One file
* Multiple files

according to the configured limits.

The upload button should be available from the main Media Library and appropriate picker contexts.

Do not force users to use drag-and-drop.

---

# 6. UPLOAD QUEUE

Uploads should use a proper upload queue.

For every upload, show:

* Filename
* File type
* File size
* Progress
* Upload status
* Success state
* Error state
* Retry action
* Cancel action where supported

Example states:

* Waiting
* Uploading
* Processing
* Completed
* Failed
* Canceled

The user must always know what is happening.

Do not perform background API/upload operations without visible feedback.

---

# 7. UPLOAD VALIDATION

Validate files both client-side and server-side.

Validation should include:

* Allowed MIME types
* File extension
* Maximum file size
* Image dimensions where relevant
* Security restrictions
* Filename safety
* Storage constraints

Client-side validation is for user experience.

**Server-side validation is authoritative and mandatory.**

Never trust the browser-provided MIME type or filename.

Do not allow dangerous file types merely because the extension has been changed.

---

# 8. MEDIA TYPES

The architecture should support multiple media types.

At minimum, design the system to support:

* Images
* Videos
* Audio
* Documents
* Other explicitly configured file types

The exact allowed types should be configurable.

The UI should understand the difference between media types.

For unsupported preview formats, show an appropriate file-type placeholder rather than breaking the interface.

---

# 9. CREATE FOLDER

The Media Manager must have a clear:

**Create Folder**

action.

Users should be able to create folders directly from the Media Library.

A folder should support:

* Name
* Parent folder
* Rename
* Move
* Delete
* Navigation
* Media assignment

Show breadcrumbs such as:

`Media Library / Products / Shoes / Summer`

Folder creation should use a proper dialog with validation.

Prevent:

* Empty folder names
* Invalid names
* Duplicate names where the architecture does not permit them
* Unsafe paths
* Accidental creation through ambiguous UI

---

# 10. FOLDER NAVIGATION

The Media Manager should behave like a real asset management system.

Users should be able to:

* Open folders
* Navigate backward
* Navigate through breadcrumbs
* Move media between folders
* Move folders
* Search within the current folder
* Search globally
* Upload directly into the current folder

Do not make users repeatedly leave the Media Manager to organize files.

---

# 11. RIGHT-CLICK / CONTEXT MENU

The current system has no proper right-click action menu.

Implement a polished context menu for media items.

For a media file, actions may include:

* Open
* Preview
* Edit details
* Rename
* Move
* Copy reference
* Download
* Replace
* Delete

For folders:

* Open
* Rename
* Move
* Delete

The exact available actions should depend on:

* Media type
* User permissions
* Current context
* Whether the item is referenced elsewhere

The context menu must not expose destructive actions without appropriate confirmation.

Also provide equivalent actions for keyboard and touch users.

---

# 12. MEDIA GRID

The default media view should be a polished grid.

Each media item should clearly show:

* Thumbnail/preview
* File type indicator where needed
* Selection state
* Important status indicators

For images:

* Use optimized thumbnails.
* Preserve aspect ratio.
* Avoid layout shifts.
* Use appropriate object fitting.

For videos/audio/documents:

* Use useful file-type previews/icons.
* Show metadata where helpful.

Hover states should provide useful actions without making the interface visually noisy.

---

# 13. LIST VIEW

Provide a list/table view for users managing large libraries.

Columns can include:

* Name
* Type
* Size
* Dimensions
* Folder
* Uploaded
* Modified
* Usage
* Actions

The list must remain usable at large library sizes.

---

# 14. SEARCH

Implement proper media search.

Search should support relevant metadata such as:

* Filename
* Title
* Alt text
* Description
* Folder
* Media type

Search should be debounced appropriately.

Do not fetch the entire media library to the browser merely to perform search.

Use server-side querying where appropriate.

Search results should remain fast even when the library becomes large.

---

# 15. FILTERING

Provide filters for:

* Media type
* Images
* Videos
* Audio
* Documents
* Folder
* Date
* File size where useful
* Unused media
* Media currently in use

Filters should be composable where practical.

The interface should clearly show active filters and allow users to reset them.

---

# 16. SORTING

Provide useful sorting options such as:

* Newest
* Oldest
* Name A–Z
* Name Z–A
* Largest
* Smallest
* Recently modified

Persist reasonable view/sort preferences when appropriate.

---

# 17. MULTI-SELECTION AND BULK ACTIONS

Users should be able to select multiple media items.

Support:

* Checkbox selection
* Click selection
* Shift selection where practical
* Select all visible results

When items are selected, show a contextual bulk-action toolbar.

Possible actions:

* Move
* Delete
* Download
* Edit metadata
* Assign folder
* Copy references

For destructive operations:

* Show exactly what will happen.
* Confirm before deleting.
* Clearly indicate items that cannot be deleted because they are in use.

---

# 18. MEDIA DETAILS AND METADATA EDITING

Every media asset should have a dedicated details/editing interface.

Support editable metadata such as:

* Filename
* Title
* Alt text
* Caption
* Description
* Folder

For images, display:

* Width
* Height
* Aspect ratio
* File size
* MIME type
* File format

For other media types, display type-specific metadata where available.

Changes should save through the proper API and provide visible loading/success/error states.

---

# 19. IMAGE PREVIEW

Clicking an image should open a high-quality preview experience.

The preview should support:

* Large image preview
* Zoom where useful
* Image dimensions
* Metadata
* Previous/next navigation
* Edit details
* Replace
* Download
* Delete
* Usage information

The preview should not require navigating away from the Media Library.

---

# 20. MEDIA REPLACEMENT

Provide a safe **Replace Media** workflow.

When replacing a media file, carefully preserve the media identity/reference when appropriate.

This is especially important when the asset is referenced by:

* Products
* Variants
* Pages
* Rich-text content
* Page-builder components
* Categories
* Brands
* Reviews

Do not accidentally break existing references.

The implementation should distinguish between:

**replacing the underlying asset**

and

**removing an asset from one particular entity.**

---

# 21. MEDIA USAGE / REFERENCES

The system must track where media is being used.

For example:

> Used in 4 places

Opening usage information should show relevant references such as:

* Product
* Product variant
* Page
* Blog/article
* Category
* Brand
* Review
* Other supported entity

The exact entity types should follow the application's architecture.

This allows users to understand the consequences of deleting an asset.

---

# 22. SAFE DELETE

Deleting a media asset must be safe.

Before deletion:

1. Check whether the media is referenced.
2. If referenced, clearly show where it is used.
3. Prevent accidental deletion or require an explicit workflow for forced deletion.
4. Remove associations correctly.
5. Delete the underlying storage object only when it is safe to do so.

Removing an image from a product must **not** automatically delete the shared media asset.

The system must distinguish:

* Remove association
* Delete media asset

---

# 23. ORPHANED MEDIA

Implement a documented strategy for orphaned media.

An asset may become unused after an association is removed.

Do not immediately delete such files unless the application's lifecycle policy explicitly requires it.

Support identifying:

* Used media
* Unused media
* Recently uploaded but unused media
* Potential orphaned assets

If automatic cleanup is implemented, make it safe, configurable, and server-controlled.

---

# 24. MEDIA PICKER

Create a reusable Media Picker based on the same centralized Media Library.

The picker should feel like a focused version of the full Media Manager rather than a completely different component.

It should support:

* Existing media browsing
* Search
* Filters
* Folder navigation
* Upload
* Drag-and-drop
* Preview
* Single selection
* Multiple selection
* Selection limits
* Confirmation
* Cancel

The picker must be configurable.

Example:

```text
MediaPicker
  allowedTypes
  multiple
  maxSelection
  initialFolder
  uploadEnabled
  selectionMode
```

Do not hardcode module-specific behavior into the picker.

---

# 25. MEDIA PICKER CONTEXTS

The same picker must support:

### Product primary image

* Images only
* Single selection

### Product gallery

* Images only
* Multiple selection

### Variant image

* Images only
* Single selection

### Brand logo

* Images only
* Single selection

### Category image

* Images only
* Single selection

### Rich text editor

* Images or configured supported media
* Appropriate selection mode

### Page builder

* Images, videos, or configured supported media

### Reviews

* Multiple images according to application limits

These must all use the same Media Manager infrastructure.

---

# 26. DRAG-AND-DROP INSIDE THE LIBRARY

Where appropriate, support drag-and-drop organization.

Examples:

* Drag media into a folder.
* Drag media between folders.
* Drag uploaded files into the current folder.
* Drag files into the Media Picker.

The UI should clearly communicate the drop target.

Do not introduce accidental moves when a user is merely trying to select an item.

---

# 27. KEYBOARD ACCESSIBILITY

The Media Manager must not depend entirely on mouse interaction.

Support keyboard-accessible:

* Search
* Upload
* Create folder
* Navigation
* Selection
* Context actions
* Preview
* Delete confirmation
* Dialog controls

Context-menu actions should have accessible equivalents.

Focus should be managed correctly when dialogs and previews open/close.

---

# 28. RESPONSIVE DESIGN

The Media Manager must work properly on:

* Desktop
* Tablet
* Smaller screens

Do not simply shrink the desktop layout.

Adapt:

* Sidebar/folder navigation
* Grid density
* Details panel
* Toolbar
* Context menus
* Upload interface
* Selection controls

The interface should remain usable on smaller screens.

---

# 29. LOADING, EMPTY, ERROR AND SUCCESS STATES

Every asynchronous operation must have visible feedback.

This is mandatory.

Examples:

* Uploading → progress indicator
* Loading media → skeleton
* Searching → appropriate loading state
* Creating folder → button/dialog loading state
* Renaming → loading state
* Moving → loading state
* Deleting → loading state
* Saving metadata → saving state
* Replacing → upload/progress state

Do not allow users to click a button and wonder whether anything happened.

Loading skeletons must closely resemble the final UI.

Do not use generic full-page spinners when a localized loading state is more appropriate.

Provide useful empty states such as:

> No media yet
> Upload your first image, video, or document.

For empty folders:

> This folder is empty
> Drag files here or upload media.

For failed operations, provide actionable errors and retry options.

---

# 30. PERFORMANCE

The Media Manager must be designed for potentially large libraries.

Do not load thousands of full-size images into the browser.

Use:

* Pagination or cursor-based pagination
* Thumbnail URLs
* Lazy loading
* Image optimization
* Server-side search
* Server-side filtering
* Efficient database queries
* Virtualization where appropriate
* Debounced search
* Incremental loading

The UI should remain responsive when the media library grows substantially.

---

# 31. STORAGE ARCHITECTURE

Store:

**Database**

* Media ID
* Original filename
* Storage key/reference
* MIME type
* File size
* Dimensions
* Metadata
* Folder ID
* Created timestamp
* Updated timestamp
* Other necessary lifecycle information

**S3-compatible storage**

* Actual binary object
* Optimized derivatives/thumbnails where applicable

Use the application's configured S3-compatible storage abstraction.

Do not hardcode a specific storage provider into UI components.

The architecture should remain compatible with providers such as:

* AWS S3
* Cloudflare R2
* MinIO
* Other S3-compatible providers

---

# 32. STORAGE OBJECT KEYS

Generate safe, deterministic storage keys.

Do not use raw user-provided filenames directly as storage paths.

Account for:

* Duplicate filenames
* Special characters
* Path traversal
* Unicode
* Renaming
* Replacement
* Folder movement

Moving a media item inside the logical Media Library should not necessarily require physically moving the S3 object.

Keep logical organization separate from physical storage where practical.

---

# 33. SECURITY

Security must be enforced server-side.

Validate:

* Authentication
* Authorization
* MIME type
* File extension
* File size
* Storage operations
* Media ownership/access
* Metadata updates
* Folder permissions
* Delete permissions

Never rely only on frontend restrictions.

Prevent:

* Unauthorized uploads
* Unauthorized media access
* Unauthorized deletion
* Path traversal
* Malicious filenames
* Unsafe file types
* Cross-user data access

Use safe signed/private storage URLs where appropriate.

---

# 34. MEDIA URL / ACCESS STRATEGY

Do not scatter storage URLs throughout the application.

Use the media abstraction/reference wherever practical.

The application should be able to determine how a media asset is rendered without every consuming feature knowing the storage implementation.

This keeps the application independent of the underlying storage provider.

---

# 35. PRODUCT INTEGRATION

Product creation/editing must use the centralized Media Picker for:

* Primary image
* Gallery
* Variant images
* Attribute-value images where supported

The product UI should never implement its own file uploader.

When selecting media:

```text
Product UI
    ↓
Shared Media Picker
    ↓
Shared Media Library
    ↓
Shared Media API
    ↓
S3-compatible storage + database
```

The product stores the media reference/ID rather than implementing its own upload mechanism.

---

# 36. VARIANT INTEGRATION

Variant image assignment must use shared media.

For bulk operations:

1. Select the target attribute/value.
2. Open Media Picker.
3. Select the shared media asset.
4. Preview affected variants.
5. Apply the association.
6. Show success/error feedback.

Do not duplicate media files for each variant.

---

# 37. BRAND AND CATEGORY INTEGRATION

Brand logos and category images must use the same Media Picker.

There must be no:

* Brand-specific uploader
* Category-specific uploader
* Separate S3 logic

Only configuration differs.

The underlying Media Manager remains the same.

---

# 38. RICH TEXT EDITOR INTEGRATION

The rich text editor must use the centralized Media Picker for media insertion.

When inserting an image:

```text
Rich Text Editor
      ↓
Media Picker
      ↓
Existing media OR upload
      ↓
Shared media reference
      ↓
Editor content
```

Do not build an independent image-upload system inside the editor.

The editor should receive media data/reference through its defined interface.

---

# 39. PAGE BUILDER INTEGRATION

Every page-builder media control must use the centralized Media Picker.

This includes:

* Images
* Background images
* Banners
* Videos
* Other supported media

Do not duplicate media assets when the same media is used in multiple components.

---

# 40. COMPONENT ARCHITECTURE

Keep Media Manager components centralized.

A reasonable architecture could be conceptually similar to:

```text
Media Manager
├── MediaLibrary
├── MediaPicker
├── MediaGrid
├── MediaList
├── MediaCard
├── MediaDetails
├── MediaPreview
├── MediaUpload
├── UploadQueue
├── FolderTree
├── FolderBreadcrumbs
├── CreateFolderDialog
├── RenameDialog
├── MoveDialog
├── DeleteDialog
├── MediaContextMenu
├── MediaFilters
├── MediaSearch
├── BulkActionBar
└── MediaUsage
```

The exact structure must follow the project's existing architecture.

Do not blindly create files matching this list if the existing architecture has a better equivalent.

The important requirement is **centralization, modularity, reuse, and separation of responsibilities.**

---

# 41. API / SERVICE ARCHITECTURE

Separate UI concerns from media operations.

The shared media service should provide reusable operations such as:

```text
listMedia()
searchMedia()
uploadMedia()
createFolder()
renameMedia()
renameFolder()
moveMedia()
moveFolder()
deleteMedia()
getMedia()
updateMediaMetadata()
getMediaUsage()
replaceMedia()
```

Use the application's existing API conventions.

Do not create a completely separate architectural pattern merely for the Media Manager.

Respect the existing backend architecture.

---

# 42. UI DESIGN REQUIREMENTS

The UI/UX quality is a major requirement.

The Media Manager should feel like a professionally designed production CMS.

Pay attention to:

* Spacing
* Typography
* Visual hierarchy
* Button hierarchy
* Icon consistency
* Hover states
* Focus states
* Selection states
* Empty states
* Error states
* Skeletons
* Dialogs
* Context menus
* Responsive behavior
* Accessibility
* Micro-interactions

Avoid:

* Crowded toolbars
* Unclear icons
* Tiny click targets
* Inconsistent spacing
* Random colors
* Excessive borders
* Generic browser-like UI
* Hidden actions
* Unexplained controls

Use tooltips for icons/actions whose purpose may not be immediately obvious.

---

# 43. DESTRUCTIVE ACTIONS

Delete operations must be clearly distinguished from normal actions.

For single deletion:

* Show confirmation.
* Explain whether the media is currently in use.

For bulk deletion:

* Show the number of selected items.
* Explain how many are safe to delete.
* Explain which items are referenced.
* Prevent accidental destructive operations.

Do not hide destructive actions behind ambiguous icons.

---

# 44. USER EXPERIENCE CONSISTENCY

The Media Manager should provide the same experience regardless of where it is opened.

For example, opening the Media Picker from:

* Product
* Brand
* Category
* Page builder
* Rich text editor
* Review

should feel like the same system.

Only the configuration should change.

Users should not need to learn five different upload interfaces.

---

# 45. NO DUPLICATE MEDIA SYSTEMS

Before implementing anything, inspect the existing project.

Identify:

* Existing media models
* Existing upload APIs
* Existing S3/storage code
* Existing image components
* Existing file upload components
* Existing media references
* Existing product image logic
* Existing editor upload logic
* Existing page-builder media logic

Reuse or refactor existing infrastructure where appropriate.

Do not create duplicate services simply because the existing implementation is messy.

If the existing Media Manager is poorly structured, improve/refactor it rather than creating a second Media Manager beside it.

---

# 46. EXISTING ARCHITECTURE MUST BE RESPECTED

This feature must integrate into the current application architecture.

Before changing code:

1. Inspect the repository structure.
2. Identify existing architectural conventions.
3. Identify existing API patterns.
4. Identify existing database conventions.
5. Identify existing UI component conventions.
6. Identify existing authentication/authorization mechanisms.
7. Identify existing storage abstraction.
8. Identify existing design system/components.
9. Identify current Media Manager implementation.
10. Identify all existing media consumers.

Then implement the Media Manager consistently with the project.

**Do not rewrite unrelated parts of the application.**

---

# 47. DO NOT BREAK EXISTING FEATURES

The Media Manager refactor must not break:

* Products
* Variants
* Brands
* Categories
* Pages
* Page builder
* Rich text editor
* Reviews
* Storefront
* Existing media references
* Existing uploaded assets

If database/schema changes are required, provide appropriate migrations and preserve existing data.

Existing media must remain usable after the migration.

---

# 48. BACKWARD COMPATIBILITY / MIGRATION

If the existing system already contains uploaded media:

* Do not discard it.
* Do not require users to manually re-upload everything.
* Map existing records into the new centralized system where possible.
* Preserve existing references.
* Migrate data safely.
* Provide compatibility handling where required.

Any migration must be deterministic and safe to rerun where appropriate.

---

# 49. EXTENSIBILITY

The Media Manager must be designed so future features can consume it without rewriting the system.

Future consumers might include:

* Email templates
* Blog editor
* Marketing campaigns
* Store settings
* Landing pages
* Navigation
* Advertisements
* Customer-generated media
* Other CMS features

A future developer should be able to integrate a new media-consuming feature by configuring the shared Media Picker rather than implementing another uploader.

---

# 50. IMPLEMENTATION ORDER

Implement this systematically.

### Stage 1 — Audit

Inspect the current application and existing Media Manager.

Document:

* Current functionality
* Current shortcomings
* Existing data model
* Existing upload/storage flow
* Existing consumers
* Existing reusable components

Do not start by blindly replacing files.

### Stage 2 — Core infrastructure

Establish/refactor:

* Media model
* Folder model
* Media references
* Storage abstraction
* Upload service
* Validation
* Permissions
* Media API
* Lifecycle handling

### Stage 3 — Media Library

Implement:

* Grid
* List
* Search
* Filters
* Sorting
* Folder navigation
* Breadcrumbs
* Upload
* Drag/drop
* Upload queue
* Create folder
* Context menu
* Preview
* Metadata
* Bulk actions
* Delete protection

### Stage 4 — Reusable Media Picker

Create the shared picker and integrate:

* Single selection
* Multiple selection
* Type restrictions
* Selection limits
* Upload
* Search
* Folder navigation
* Preview

### Stage 5 — Existing integrations

Migrate existing consumers to the centralized system:

* Products
* Variants
* Brands
* Categories
* Rich text editor
* Page builder
* Reviews
* Other existing media consumers

### Stage 6 — Hardening

Test:

* Permissions
* Large uploads
* Invalid files
* Duplicate names
* Large media libraries
* Concurrent uploads
* Failed uploads
* Retry
* Delete protection
* Folder operations
* Existing media migration
* Broken references
* Responsive behavior
* Keyboard accessibility

---

# 51. PERFORMANCE REQUIREMENTS

The implementation must be optimized for production.

Do not:

* Fetch the entire media library unnecessarily.
* Load original-size images into every grid card.
* Re-render the entire library after every operation.
* Upload through unnecessary intermediate layers.
* Perform expensive client-side filtering over thousands of assets.

Prefer:

* Cursor pagination
* Optimized thumbnails
* Lazy loading
* Server-side filtering/searching
* Efficient cache invalidation
* Optimistic UI where safe
* Incremental updates
* Background processing where appropriate

---

# 52. ACCEPTANCE CRITERIA

The implementation is complete only when all of the following are true:

### Core

* There is exactly one centralized Media Manager.
* There is exactly one shared media upload system.
* There is exactly one shared Media Picker.
* All media-consuming features use the shared system.

### Upload

* Users can click Upload.
* Users can drag and drop files.
* Multiple files can be uploaded.
* Upload progress is visible.
* Failed uploads are clearly shown.
* Failed uploads can be retried where possible.
* File validation happens client-side and server-side.

### Organization

* Users can create folders.
* Users can rename folders.
* Users can move media.
* Users can move folders where supported.
* Users can navigate folders.
* Breadcrumbs work correctly.
* Users can organize large libraries efficiently.

### Management

* Grid view works.
* List view works.
* Search works.
* Filtering works.
* Sorting works.
* Preview works.
* Metadata editing works.
* Right-click/context menu works.
* Bulk selection works.
* Bulk actions work.
* Delete confirmation works.
* Referenced media is protected.

### References

* Media can be reused across modules.
* Removing a media association does not delete the shared asset.
* Media usage can be identified.
* Existing references remain valid.
* Orphaned media has a safe lifecycle strategy.

### Integrations

* Products use the shared Media Picker.
* Product galleries use the shared Media Picker.
* Variants use the shared Media Picker.
* Brands use the shared Media Picker.
* Categories use the shared Media Picker.
* Rich text editor uses the shared Media Picker.
* Page builder uses the shared Media Picker.
* Reviews use the shared Media Picker where applicable.

### UX

* Every asynchronous action has visible feedback.
* Loading states are clear.
* Skeletons match the actual UI.
* Empty states are useful.
* Error states are actionable.
* Tooltips explain unclear actions.
* Destructive actions are clearly communicated.
* Keyboard interaction is supported.
* The interface is responsive.
* The UI follows the existing application's design system.

### Architecture

* Existing project architecture is respected.
* Existing storage abstraction is reused/refactored.
* Existing authentication and authorization are respected.
* Existing API conventions are respected.
* Existing media is preserved.
* No unrelated application functionality is rewritten.
* No duplicate upload system is introduced.

---

# 53. IMPORTANT IMPLEMENTATION RULE

**Do not implement this as a collection of isolated UI features.**

The result should be a coherent media platform.

Think of the architecture as:

```text
                    ┌─────────────────────┐
                    │   Media Consumers   │
                    │                     │
                    │ Products            │
                    │ Variants            │
                    │ Brands              │
                    │ Categories          │
                    │ Page Builder        │
                    │ Rich Text Editor    │
                    │ Reviews             │
                    │ Future Features     │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Shared Media      │
                    │      Picker         │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Media Library     │
                    │                     │
                    │ Search              │
                    │ Filters             │
                    │ Folders             │
                    │ Grid/List           │
                    │ Upload              │
                    │ Drag & Drop         │
                    │ Preview             │
                    │ Metadata            │
                    │ Bulk Actions        │
                    │ Context Menu        │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │    Media Service    │
                    │                     │
                    │ Validation          │
                    │ Permissions         │
                    │ References          │
                    │ Lifecycle           │
                    │ Upload Processing   │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
             ┌──────────────┐      ┌──────────────┐
             │   Database   │      │ S3-Compatible│
             │              │      │   Storage    │
             │ Media        │      │              │
             │ Folders      │      │ Original     │
             │ References   │      │ Thumbnails   │
             │ Metadata     │      │ Derivatives  │
             └──────────────┘      └──────────────┘
```

The architecture should make it possible for any future feature to say:

> “I need media.”

and receive the same centralized Media Picker/Media Manager experience without implementing its own upload, storage, validation, or media-management logic.

**Prioritize correctness, reusability, performance, security, and exceptional UI/UX.**

Do not stop at making the current Media Manager functional. Transform it into a complete, extensible media-management platform suitable for a production e-commerce/CMS application.
