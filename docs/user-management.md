# User Management Module

## Overview

The User Management Module (`src/users/`) provides administrative user lifecycle management and self-service profile endpoints under the `/api/users` prefix. It integrates with:

- **JWT Authentication** (`JwtAuthGuard`, `CurrentUser`)
- **Database-Driven RBAC** (`PermissionsGuard`, `@RequirePermissions(...)`)
- **Prisma ORM 7 & PostgreSQL** (`User`, `UserStatus`, `Role`, `RefreshToken`)
- **Global API Envelopes** (`ResponseInterceptor`, `GlobalExceptionFilter`)
- **Rate Limiting** (`RATE_LIMIT_POLICIES.ADMIN_WRITE` on write endpoints)

All responses follow the global API envelope:

```json
{
  "success": true,
  "data": {},
  "timestamp": "2026-11-17T03:00:00.000Z",
  "path": "/api/users"
}
```

Sensitive fields (`passwordHash`, `refreshTokens`) are never selected or returned.

---

## Permissions & Seed Behavior

The following permissions are registered in `prisma/seed.ts`:

| Permission | Description | Default Role Assignment |
| --- | --- | --- |
| `user:read` | List users and view user details | `ADMIN` only |
| `user:create` | Create new user accounts | `ADMIN` only |
| `user:update` | Update user profile fields | `ADMIN` only |
| `user:role:assign` | Assign a role to a user | `ADMIN` only |
| `user:status:update` | Change user account status | `ADMIN` only |
| `user:delete` | Soft-deactivate user accounts | `ADMIN` only |

- `STAFF` and `CUSTOMER` do **not** receive any `user:*` permissions by default.
- `STAFF` is explicitly guarded in `prisma/seed.ts` (`staffForbiddenPermissionCodes`) against holding `user:create`, `user:update`, `user:role:assign`, `user:status:update`, `user:delete`, `user:manage`, and `role:manage`.
- Admins can dynamically grant `user:read` (or other permissions) to custom roles via the RBAC API.

---

## Endpoints

### 1. Get Current User Profile
- **Route:** `GET /api/users/me`
- **Auth:** Bearer JWT required (`JwtAuthGuard`)
- **Permissions:** None (self-service, identity derived strictly from `req.user.sub`)

**Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Aye Aye",
    "email": "ayeaye@example.com",
    "phone": "+959400100005",
    "roleId": "11111111-1111-4111-8111-111111111111",
    "isActive": true,
    "status": "ACTIVE",
    "createdAt": "2026-10-30T08:00:00.000Z",
    "updatedAt": "2026-10-30T08:00:00.000Z",
    "role": {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "CUSTOMER",
      "description": "Customer role"
    }
  },
  "timestamp": "2026-11-17T03:00:00.000Z",
  "path": "/api/users/me"
}
```

### 2. Update Current User Profile
- **Route:** `PATCH /api/users/me`
- **Auth:** Bearer JWT required
- **Body (`UpdateProfileDto`):** Only `name` and `phone` are permitted. Attempting to pass `roleId`, `status`, `isActive`, `password`, or `id` returns `400 Bad Request`.

```json
{
  "name": "Aye Aye Updated",
  "phone": "+959400100055"
}
```

### 3. List Users
- **Route:** `GET /api/users`
- **Permission:** `user:read`
- **Query Parameters:**
  - `page` (int, `1..10000`, default `1`)
  - `limit` (int, `1..100`, default `20`)
  - `search` (string, max 100 chars; matches `name`, `email`, or `phone` case-insensitively)
  - `roleId` (UUID)
  - `role` (string; role name, e.g. `CUSTOMER`, `STAFF`, `ADMIN`)
  - `status` (`ACTIVE` | `SUSPENDED` | `DEACTIVATED`)
  - `isActive` (`true` | `false`)
  - `sortBy` (`createdAt` | `updatedAt` | `name` | `email`, default `createdAt`)
  - `sortOrder` (`asc` | `desc`, default `desc`)

### 4. Get User Detail
- **Route:** `GET /api/users/:id`
- **Permission:** `user:read`
- **Errors:** `400` (invalid UUID), `401`, `403`, `404` (user not found)

**Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Aye Aye",
      "email": "customer@example.com",
      "phone": null,
      "role": "CUSTOMER",
      "createdAt": "2026-10-30T08:00:00.000Z",
      "roleId": "550e8400-e29b-41d4-a716-446655440001",
      "isActive": true,
      "status": "ACTIVE",
      "updatedAt": "2026-10-30T08:00:00.000Z"
    },
    "permissions": [
      "category:read",
      "product:read"
    ]
  },
  "timestamp": "2026-11-17T03:00:00.000Z",
  "path": "/api/users/550e8400-e29b-41d4-a716-446655440000"
}
```

### 5. Create User (Admin)
- **Route:** `POST /api/users`
- **Permission:** `user:create`
- **MVP Approach:** Admin-provisioned creation with an initial password (8–72 chars) hashed using the shared bcrypt cost-12 helper (`hashPassword`) and an explicit `roleId`. Arbitrary `permissions` are rejected (`400 Bad Request`).
- **Body (`CreateUserDto`):**
```json
{
  "name": "Kyaw Kyaw",
  "email": "kyawkyaw@example.com",
  "phone": "+959400100099",
  "password": "StrongPassword123",
  "roleId": "11111111-1111-4111-8111-111111111111",
  "status": "ACTIVE"
}
```
- **Errors:** `400`, `401`, `403`, `404` (role not found), `409` (duplicate email or phone)

### 6. Update User
- **Route:** `PATCH /api/users/:id`
- **Permission:** `user:update`
- **Body (`UpdateUserDto`):** `name`, `email`, `phone` only. Password and role updates are rejected (`400 Bad Request`).

### 7. Assign User Role
- **Route:** `PATCH /api/users/:id/role`
- **Permission:** `user:role:assign`
- **Body (`UpdateUserRoleDto`):**
```json
{
  "roleId": "22222222-2222-4222-8222-222222222222"
}
```
- **Safeguards:**
  - Rejects self-role changes (`403 Forbidden`).
  - Prevents privilege escalation: an actor without `role:manage` cannot assign a role containing permissions they do not hold (`403 Forbidden`).
  - Protects the last active administrator holding `role:manage` using row-level `FOR UPDATE` locking (`409 Conflict`).

### 8. Update Account Status
- **Route:** `PATCH /api/users/:id/status`
- **Permission:** `user:status:update`
- **Body (`UpdateUserStatusDto`):**
```json
{
  "status": "SUSPENDED"
}
```
- **Safeguards:**
  - Transactional update of `status` and `isActive` (`isActive = status === 'ACTIVE'`).
  - When `status` is `SUSPENDED` or `DEACTIVATED`, all active `RefreshToken` rows for the user are revoked (`revokedAt = now()`).
  - `AuthService.login`, `AuthService.refresh`, `AuthService.getProfile`, and `PermissionsGuard` all reject non-`ACTIVE` users.
  - Prevents self-disablement and disabling the last active administrator (`409 Conflict`).

### 9. Deactivate User (Soft Delete)
- **Route:** `DELETE /api/users/:id`
- **Permission:** `user:delete`
- **Behavior:** Soft-deactivates the user (`status = DEACTIVATED`, `isActive = false`) and revokes all active refresh tokens inside a transaction. Hard deletion is intentionally avoided to preserve `Order` (`onDelete: Restrict`), `PaymentAttempt`, `PaymentEvent`, `StockMovement`, and `CmsDocument` audit history.
- **Errors:** `400`, `401`, `403`, `404`, `409` (self-deactivation or last active administrator)
