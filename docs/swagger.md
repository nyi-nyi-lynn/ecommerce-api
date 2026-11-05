# Swagger / OpenAPI

The application exposes Swagger UI at `/api/docs` and its OpenAPI JSON at
`/api/docs-json`. The document uses the global `/api` prefix, OpenAPI 3.x, and
HTTP Bearer authentication for routes protected by the JWT guard. Swagger UI
persists authorization for the current browser session.

Documentation is enabled by default outside production. When
`NODE_ENV=production`, it is disabled unless `SWAGGER_ENABLED=true` is set
explicitly. Do not enable it in a production deployment unless public API
documentation is an intentional deployment decision.

Success and error response examples follow the application's global response
interceptor and exception filter. Permission-protected operations document the
permission code and explain that authorization is resolved from current
database permissions; JWT role claims are not the source of truth.

Product and Category write endpoints (`POST` and `PATCH`) accept both
`multipart/form-data` (using the `image` binary file field, validated and
uploaded via the shared Cloudinary `UploadsService`) and `application/json`.
Product endpoints also support an optional `imageUrl` fallback when no file is
uploaded. Payment gateway processing and refund endpoints are not implemented.
