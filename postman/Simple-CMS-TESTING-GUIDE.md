# Simple CMS Postman Testing Guide

This collection targets the current direct-content CMS (`CmsDocument → CmsSection → CmsSectionItem`). It does not use the removed revision APIs. Requests are based on the CMS controllers and DTOs in `src/cms/`.

## Import and configure

1. Import `Simple-CMS.postman_collection.json` and `Simple-CMS.postman_environment.json` into Postman.
2. Select the **Simple CMS Local** environment.
3. Set `baseUrl` to the API root, including the global prefix. The default is `http://localhost:3000/api`.
4. Enter existing local test-account values in `adminEmail` and `adminPassword`. The collection does not register accounts or contain credentials.
5. Run **00 - Authentication & Setup → Login - Admin**. Its test script saves the returned `data.accessToken` to `adminAccessToken` and `accessToken`.
6. If you want to verify a forbidden customer request, enter an existing customer account in `customerEmail` and `customerPassword`, then run **Login - Customer**. Its script saves `customerAccessToken`.

Never paste production credentials or tokens into an exported environment. Keep this collection pointed at local/test environments.

## Request order

For a full lifecycle demonstration, run the folders/requests in this order:

1. Authenticate the admin.
2. In **01 - Document Management**, create the `about-us` document. The script captures `documentId` and `documentKey`. Run list, ID detail, key detail, and metadata update.
3. In **02 - Section Management**, create the visible `hero` section and a hidden `internal-note` section. The scripts capture `sectionId` and `hiddenSectionId`. List, get, update, set visibility, and reorder while both sections exist.
4. In **03 - Section Item Management**, create two items under the hero. The scripts capture `sectionItemId` and `secondSectionItemId`. List, get, update, and reorder while both items exist.
5. In **04 - Publishing Workflow**, preview the draft and verify its public detail request returns 404. Publish, then call the public list and detail. The public detail test checks the page key, that the hidden section is absent, and ordering of visible sections/items.
6. Update the already-published document and verify its status remains `PUBLISHED` and the public title reflects the update.
7. After the public visibility checks, delete the hidden section and second item (these requests are destructive), unpublish, and verify public detail returns 404.
8. Run **05 - Cloudinary Image Upload** only if Cloudinary is configured and you explicitly want to upload files. It creates a separate uniquely keyed image test document and has a cleanup request at the end of the folder.
9. Run **06 - Negative & Validation Tests** against local/test data only. Some requests intentionally fail and return error envelopes. The final request deletes the main test document and its nested content. Document deletion cascades to sections/items and may clean up unreferenced CMS images. Run it only when you are finished with the test data.

Requests that create, update, publish, unpublish, reorder, or delete content change application data. GET requests are read-only. The optional upload requests create real Cloudinary assets; the application may later clean unused CMS assets as part of a resource update/delete. Do not run mutating or negative tests against production.

## Routes and permissions

All admin routes require a JWT and dynamically loaded database permissions. The JWT role claim is not the authorization source of truth.

| Route family | Permission |
|---|---|
| `GET /cms/documents`, `GET /cms/documents/by-key/:key`, document/section/item detail and list, admin preview | `cms:read` |
| `POST /cms/documents`, `POST /cms/documents/:documentId/sections`, `POST /cms/sections/:sectionId/items` | `cms:create` |
| Document/section/item PATCH, visibility, reorder, publish, unpublish | `cms:update` |
| Document/section/item DELETE | `cms:delete` |
| Any admin request that includes an `image` file | Also requires `media:upload` |
| `GET /cms/pages` and `GET /cms/pages/:key` | Public; no JWT required |

The `PermissionsGuard` reads the user's current permissions from the database. A valid token without the required permission should receive 403; missing/invalid authentication on admin routes should receive 401. Public route requests explicitly disable inherited collection authentication.

## Payload and validation notes

The main create-document request uses JSON:

```json
{
  "key": "about-us",
  "title": "About Our Store",
  "seoTitle": "About Our Store | Northstar",
  "seoDescription": "Learn about Northstar, our people, and our promise to make technology easier to choose."
}
```

Document keys must match the lowercase key pattern and be at most 100 characters. Titles are required on creation and are limited to 150 characters. SEO title and description are optional (maximum 70 and 160 characters).

Create-section JSON uses the current schema: `key`, `type`, non-negative `position`, optional `isVisible`, and an object-valued `content`. Section `type` is a validated string, not a server enum. The example content keys (`headline`, `supportingText`, `ctaLabel`, `ctaUrl`) are sample JSON content and are not a fixed server-side content schema.

Section items support `position`, nullable `title`, `body`, `url`, `label`, and `categoryId`. URLs accept HTTP(S), `mailto:`, or root-relative paths. Omitted nullable fields stay unchanged on PATCH; explicit `null` clears them. Quantities/positions must be valid integers as enforced by each DTO. Unknown request properties are rejected by the global ValidationPipe.

The shared response interceptor wraps successful JSON as:

```json
{"success":true,"data":{},"timestamp":"...","path":"/api/cms/..."}
```

Errors use the standard error envelope with `success: false`, `statusCode`, `message`, `error`, `timestamp`, and `path`. The Postman scripts check these shapes and expected status codes.

## Multipart image requests

The only CMS routes accepting image files are resource-specific create/update requests:

| Method and route | Form-data file field | Additional fields |
|---|---|---|
| `POST /cms/documents` | `image` | required `key`, `title`; optional `seoTitle`, `seoDescription` |
| `PATCH /cms/documents/:documentId` | `image` | optional `title`, `seoTitle`, `seoDescription` |
| `POST /cms/documents/:documentId/sections` | `image` | required `key`, `type`, `position`, `content`; optional `isVisible` |
| `PATCH /cms/sections/:sectionId` | `image` | any supported section fields, including `content` |

The file limit is 5 MB. The shared `UploadsService` checks detected file bytes and accepts JPEG, PNG, WebP, or AVIF; the form-data field must be named exactly `image`. For section `content`, enter valid JSON text in the multipart field. To run an upload request, open Body → form-data, select the `image` row's type as **File**, and choose a local image. Postman does not resolve a filesystem path variable into a file attachment, so file selection is intentionally manual. These requests require `media:upload` in addition to the route's CMS permission and use the configured Cloudinary integration.

The negative file tests also require manual selection: choose a text/non-image file for invalid type, or an image larger than 5 MB for the size test. They should be rejected by validation/middleware before a Cloudinary upload.

## Negative tests and cleanup

The negative folder covers missing/invalid tokens, a customer lacking CMS permission, a separate `cms:create`-only account check for `media:upload` (requires an account with that exact permission setup), duplicate document key, unknown DTO properties, malformed UUIDs, invalid pagination, empty reorder IDs, missing document/section relations, missing category relation, invalid URL scheme, unpublished/missing public pages, invalid file type, and oversized file. Error expectations reflect the current controllers, DTO validation, upload middleware, and global exception filter. A normal CUSTOMER token without `cms:create` only verifies the CMS permission check, not the additional media permission.

Use the `documentId`, `documentKey`, `sectionId`, `hiddenSectionId`, `sectionItemId`, and `secondSectionItemId` values captured by successful create responses. If a create request fails, its ID variable is left untouched rather than replaced with an empty value. The optional media checks capture `imageDocumentId` and `imageSectionId` for cleanup if you create those resources; remove those test records through the documented admin delete routes after review.

The collection has not been run through Postman/Newman as part of file generation. It is ready to import, but local account permissions, server availability, and Cloudinary configuration determine runtime results.
