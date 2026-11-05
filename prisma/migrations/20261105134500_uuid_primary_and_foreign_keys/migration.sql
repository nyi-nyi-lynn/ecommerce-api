-- Phase 2B.2: Data-Preserving Integer-to-UUID Primary & Foreign Key Migration
-- Converts all 14 remaining integer-keyed models and all 19 dependent foreign keys
-- to native PostgreSQL UUID while preserving existing records, relationships,
-- business quantity/monetary columns, check constraints, partial indexes, and
-- PaymentEvent append-only protections.

-- ============================================================================
-- STAGE 1: Temporarily Suspend PaymentEvent Row-Update Trigger During Backfill
-- ============================================================================
DROP TRIGGER IF EXISTS "PaymentEvent_append_only" ON "PaymentEvent";

-- ============================================================================
-- STAGE 2: Expand — Add Shadow UUID Primary Key & Foreign Key Columns
-- ============================================================================

-- Tier 0: Root parent tables
ALTER TABLE "Role"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE "Permission"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE "Category"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid();

-- Tier 1: Tables referencing Tier 0
ALTER TABLE "RolePermission"
    ADD COLUMN "roleId_uuid" UUID,
    ADD COLUMN "permissionId_uuid" UUID;

ALTER TABLE "User"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "roleId_uuid" UUID;

ALTER TABLE "Product"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "categoryId_uuid" UUID;

-- Tier 2: Tables referencing Tier 1
-- Note: RefreshToken.id, familyId, and replacedByTokenId are already UUID.
ALTER TABLE "RefreshToken"
    ADD COLUMN "userId_uuid" UUID;

ALTER TABLE "stocks"
    ADD COLUMN "productId_uuid" UUID;

ALTER TABLE "Cart"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "userId_uuid" UUID;

ALTER TABLE "Order"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "userId_uuid" UUID;

-- Tier 3: Tables referencing Tiers 1 & 2
ALTER TABLE "CartItem"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "cartId_uuid" UUID,
    ADD COLUMN "productId_uuid" UUID;

ALTER TABLE "OrderItem"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "orderId_uuid" UUID,
    ADD COLUMN "productId_uuid" UUID;

ALTER TABLE "StockMovement"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "productId_uuid" UUID,
    ADD COLUMN "orderId_uuid" UUID,
    ADD COLUMN "userId_uuid" UUID;

ALTER TABLE "PaymentAttempt"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "orderId_uuid" UUID,
    ADD COLUMN "reviewedById_uuid" UUID;

-- Tier 4: Leaf table referencing Tiers 1 & 3
ALTER TABLE "PaymentEvent"
    ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "paymentAttemptId_uuid" UUID,
    ADD COLUMN "actorId_uuid" UUID;

-- ============================================================================
-- STAGE 3: Backfill Foreign Keys Using In-Row Old-ID to New-UUID Mapping
-- ============================================================================

-- Tier 1 Backfill
UPDATE "RolePermission" AS rp
SET "roleId_uuid" = r."id_uuid",
    "permissionId_uuid" = p."id_uuid"
FROM "Role" AS r, "Permission" AS p
WHERE rp."roleId" = r."id"
  AND rp."permissionId" = p."id";

UPDATE "User" AS u
SET "roleId_uuid" = r."id_uuid"
FROM "Role" AS r
WHERE u."roleId" = r."id";

UPDATE "Product" AS pr
SET "categoryId_uuid" = c."id_uuid"
FROM "Category" AS c
WHERE pr."categoryId" = c."id";

-- Tier 2 Backfill
UPDATE "RefreshToken" AS rt
SET "userId_uuid" = u."id_uuid"
FROM "User" AS u
WHERE rt."userId" = u."id";

UPDATE "stocks" AS s
SET "productId_uuid" = pr."id_uuid"
FROM "Product" AS pr
WHERE s."productId" = pr."id";

UPDATE "Cart" AS c
SET "userId_uuid" = u."id_uuid"
FROM "User" AS u
WHERE c."userId" = u."id";

UPDATE "Order" AS o
SET "userId_uuid" = u."id_uuid"
FROM "User" AS u
WHERE o."userId" = u."id";

-- Tier 3 Backfill
UPDATE "CartItem" AS ci
SET "cartId_uuid" = c."id_uuid",
    "productId_uuid" = pr."id_uuid"
FROM "Cart" AS c, "Product" AS pr
WHERE ci."cartId" = c."id"
  AND ci."productId" = pr."id";

UPDATE "OrderItem" AS oi
SET "orderId_uuid" = o."id_uuid",
    "productId_uuid" = pr."id_uuid"
FROM "Order" AS o, "Product" AS pr
WHERE oi."orderId" = o."id"
  AND oi."productId" = pr."id";

UPDATE "StockMovement" AS sm
SET "productId_uuid" = pr."id_uuid"
FROM "Product" AS pr
WHERE sm."productId" = pr."id";

UPDATE "StockMovement" AS sm
SET "orderId_uuid" = o."id_uuid"
FROM "Order" AS o
WHERE sm."orderId" IS NOT NULL
  AND sm."orderId" = o."id";

UPDATE "StockMovement" AS sm
SET "userId_uuid" = u."id_uuid"
FROM "User" AS u
WHERE sm."userId" IS NOT NULL
  AND sm."userId" = u."id";

UPDATE "PaymentAttempt" AS pa
SET "orderId_uuid" = o."id_uuid"
FROM "Order" AS o
WHERE pa."orderId" = o."id";

UPDATE "PaymentAttempt" AS pa
SET "reviewedById_uuid" = u."id_uuid"
FROM "User" AS u
WHERE pa."reviewedById" IS NOT NULL
  AND pa."reviewedById" = u."id";

-- Tier 4 Backfill
UPDATE "PaymentEvent" AS pe
SET "paymentAttemptId_uuid" = pa."id_uuid"
FROM "PaymentAttempt" AS pa
WHERE pe."paymentAttemptId" = pa."id";

UPDATE "PaymentEvent" AS pe
SET "actorId_uuid" = u."id_uuid"
FROM "User" AS u
WHERE pe."actorId" IS NOT NULL
  AND pe."actorId" = u."id";

-- ============================================================================
-- STAGE 4: Pre-Cutover Relationship & Nullability Integrity Assertions
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "RolePermission"
        WHERE "roleId_uuid" IS NULL OR "permissionId_uuid" IS NULL
    ) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped foreign key in RolePermission';
    END IF;

    IF EXISTS (SELECT 1 FROM "User" WHERE "roleId_uuid" IS NULL) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped roleId in User';
    END IF;

    IF EXISTS (SELECT 1 FROM "Product" WHERE "categoryId_uuid" IS NULL) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped categoryId in Product';
    END IF;

    IF EXISTS (SELECT 1 FROM "RefreshToken" WHERE "userId_uuid" IS NULL) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped userId in RefreshToken';
    END IF;

    IF EXISTS (SELECT 1 FROM "stocks" WHERE "productId_uuid" IS NULL) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped productId in stocks';
    END IF;

    IF EXISTS (SELECT 1 FROM "Cart" WHERE "userId_uuid" IS NULL) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped userId in Cart';
    END IF;

    IF EXISTS (SELECT 1 FROM "Order" WHERE "userId_uuid" IS NULL) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped userId in Order';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "CartItem"
        WHERE "cartId_uuid" IS NULL OR "productId_uuid" IS NULL
    ) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped foreign key in CartItem';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "OrderItem"
        WHERE "orderId_uuid" IS NULL OR "productId_uuid" IS NULL
    ) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped foreign key in OrderItem';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "StockMovement"
        WHERE "productId_uuid" IS NULL
           OR (("orderId" IS NULL) <> ("orderId_uuid" IS NULL))
           OR (("userId" IS NULL) <> ("userId_uuid" IS NULL))
    ) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped foreign key in StockMovement';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "PaymentAttempt"
        WHERE "orderId_uuid" IS NULL
           OR (("reviewedById" IS NULL) <> ("reviewedById_uuid" IS NULL))
    ) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped foreign key in PaymentAttempt';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "PaymentEvent"
        WHERE "paymentAttemptId_uuid" IS NULL
           OR (("actorId" IS NULL) <> ("actorId_uuid" IS NULL))
    ) THEN
        RAISE EXCEPTION 'UUID migration aborted: unmapped foreign key in PaymentEvent';
    END IF;
END $$;

-- ============================================================================
-- STAGE 5: Swap & Contract — Drop Old FKs/PKs/Columns and Promote UUID Columns
-- ============================================================================

-- 5.1 Drop all 19 integer Foreign Key constraints (Bottom-Up Tier 4 -> Tier 1)
ALTER TABLE "PaymentEvent" DROP CONSTRAINT "PaymentEvent_actorId_fkey";
ALTER TABLE "PaymentEvent" DROP CONSTRAINT "PaymentEvent_paymentAttemptId_fkey";

ALTER TABLE "PaymentAttempt" DROP CONSTRAINT "PaymentAttempt_reviewedById_fkey";
ALTER TABLE "PaymentAttempt" DROP CONSTRAINT "PaymentAttempt_orderId_fkey";

ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_orderId_fkey";
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_userId_fkey";
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_productId_fkey";

ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_fkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_fkey";

ALTER TABLE "CartItem" DROP CONSTRAINT "CartItem_productId_fkey";
ALTER TABLE "CartItem" DROP CONSTRAINT "CartItem_cartId_fkey";

ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";
ALTER TABLE "Cart" DROP CONSTRAINT "Cart_userId_fkey";
ALTER TABLE "stocks" DROP CONSTRAINT "stocks_productId_fkey";
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_fkey";

ALTER TABLE "Product" DROP CONSTRAINT "Product_categoryId_fkey";
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_permissionId_fkey";
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_roleId_fkey";

-- 5.2 Drop all 14 integer Primary Key constraints
ALTER TABLE "PaymentEvent" DROP CONSTRAINT "PaymentEvent_pkey";
ALTER TABLE "PaymentAttempt" DROP CONSTRAINT "PaymentAttempt_pkey";
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_pkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_pkey";
ALTER TABLE "CartItem" DROP CONSTRAINT "CartItem_pkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_pkey";
ALTER TABLE "Cart" DROP CONSTRAINT "Cart_pkey";
ALTER TABLE "stocks" DROP CONSTRAINT "stocks_pkey";
ALTER TABLE "Product" DROP CONSTRAINT "Product_pkey";
ALTER TABLE "User" DROP CONSTRAINT "User_pkey";
ALTER TABLE "Category" DROP CONSTRAINT "Category_pkey";
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_pkey";
ALTER TABLE "Permission" DROP CONSTRAINT "Permission_pkey";
ALTER TABLE "Role" DROP CONSTRAINT "Role_pkey";

-- 5.3 Drop legacy integer columns and rename shadow UUID columns (Tier 0 -> Tier 4)
ALTER TABLE "Role" DROP COLUMN "id";
ALTER TABLE "Role" RENAME COLUMN "id_uuid" TO "id";

ALTER TABLE "Permission" DROP COLUMN "id";
ALTER TABLE "Permission" RENAME COLUMN "id_uuid" TO "id";

ALTER TABLE "Category" DROP COLUMN "id";
ALTER TABLE "Category" RENAME COLUMN "id_uuid" TO "id";

ALTER TABLE "RolePermission"
    DROP COLUMN "roleId",
    DROP COLUMN "permissionId";
ALTER TABLE "RolePermission" RENAME COLUMN "roleId_uuid" TO "roleId";
ALTER TABLE "RolePermission" RENAME COLUMN "permissionId_uuid" TO "permissionId";
ALTER TABLE "RolePermission"
    ALTER COLUMN "roleId" SET NOT NULL,
    ALTER COLUMN "permissionId" SET NOT NULL;

ALTER TABLE "User"
    DROP COLUMN "id",
    DROP COLUMN "roleId";
ALTER TABLE "User" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "User" RENAME COLUMN "roleId_uuid" TO "roleId";
ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;

ALTER TABLE "Product"
    DROP COLUMN "id",
    DROP COLUMN "categoryId";
ALTER TABLE "Product" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "Product" RENAME COLUMN "categoryId_uuid" TO "categoryId";
ALTER TABLE "Product" ALTER COLUMN "categoryId" SET NOT NULL;

ALTER TABLE "RefreshToken" DROP COLUMN "userId";
ALTER TABLE "RefreshToken" RENAME COLUMN "userId_uuid" TO "userId";
ALTER TABLE "RefreshToken" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "stocks" DROP COLUMN "productId";
ALTER TABLE "stocks" RENAME COLUMN "productId_uuid" TO "productId";
ALTER TABLE "stocks" ALTER COLUMN "productId" SET NOT NULL;

ALTER TABLE "Cart"
    DROP COLUMN "id",
    DROP COLUMN "userId";
ALTER TABLE "Cart" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "Cart" RENAME COLUMN "userId_uuid" TO "userId";
ALTER TABLE "Cart" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "Order"
    DROP COLUMN "id",
    DROP COLUMN "userId";
ALTER TABLE "Order" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "Order" RENAME COLUMN "userId_uuid" TO "userId";
ALTER TABLE "Order" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "CartItem"
    DROP COLUMN "id",
    DROP COLUMN "cartId",
    DROP COLUMN "productId";
ALTER TABLE "CartItem" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "CartItem" RENAME COLUMN "cartId_uuid" TO "cartId";
ALTER TABLE "CartItem" RENAME COLUMN "productId_uuid" TO "productId";
ALTER TABLE "CartItem"
    ALTER COLUMN "cartId" SET NOT NULL,
    ALTER COLUMN "productId" SET NOT NULL;

ALTER TABLE "OrderItem"
    DROP COLUMN "id",
    DROP COLUMN "orderId",
    DROP COLUMN "productId";
ALTER TABLE "OrderItem" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "OrderItem" RENAME COLUMN "orderId_uuid" TO "orderId";
ALTER TABLE "OrderItem" RENAME COLUMN "productId_uuid" TO "productId";
ALTER TABLE "OrderItem"
    ALTER COLUMN "orderId" SET NOT NULL,
    ALTER COLUMN "productId" SET NOT NULL;

ALTER TABLE "StockMovement"
    DROP COLUMN "id",
    DROP COLUMN "productId",
    DROP COLUMN "orderId",
    DROP COLUMN "userId";
ALTER TABLE "StockMovement" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "StockMovement" RENAME COLUMN "productId_uuid" TO "productId";
ALTER TABLE "StockMovement" RENAME COLUMN "orderId_uuid" TO "orderId";
ALTER TABLE "StockMovement" RENAME COLUMN "userId_uuid" TO "userId";
ALTER TABLE "StockMovement" ALTER COLUMN "productId" SET NOT NULL;

ALTER TABLE "PaymentAttempt"
    DROP COLUMN "id",
    DROP COLUMN "orderId",
    DROP COLUMN "reviewedById";
ALTER TABLE "PaymentAttempt" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "PaymentAttempt" RENAME COLUMN "orderId_uuid" TO "orderId";
ALTER TABLE "PaymentAttempt" RENAME COLUMN "reviewedById_uuid" TO "reviewedById";
ALTER TABLE "PaymentAttempt" ALTER COLUMN "orderId" SET NOT NULL;

ALTER TABLE "PaymentEvent"
    DROP COLUMN "id",
    DROP COLUMN "paymentAttemptId",
    DROP COLUMN "actorId";
ALTER TABLE "PaymentEvent" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "PaymentEvent" RENAME COLUMN "paymentAttemptId_uuid" TO "paymentAttemptId";
ALTER TABLE "PaymentEvent" RENAME COLUMN "actorId_uuid" TO "actorId";
ALTER TABLE "PaymentEvent" ALTER COLUMN "paymentAttemptId" SET NOT NULL;

-- ============================================================================
-- STAGE 6: Recreate Primary Keys, Indexes, Foreign Keys, and Triggers
-- ============================================================================

-- 6.1 Recreate Primary Key constraints (Tier 0 -> Tier 4)
ALTER TABLE "Role" ADD CONSTRAINT "Role_pkey" PRIMARY KEY ("id");
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_pkey" PRIMARY KEY ("id");
ALTER TABLE "Category" ADD CONSTRAINT "Category_pkey" PRIMARY KEY ("id");
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId");
ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");
ALTER TABLE "Product" ADD CONSTRAINT "Product_pkey" PRIMARY KEY ("id");
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_pkey" PRIMARY KEY ("productId");
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_pkey" PRIMARY KEY ("id");
ALTER TABLE "Order" ADD CONSTRAINT "Order_pkey" PRIMARY KEY ("id");
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id");
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id");
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id");

-- 6.2 Recreate Unique, Composite, Secondary, and Partial Indexes on UUID columns
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_userId_familyId_idx" ON "RefreshToken"("userId", "familyId");

CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");
CREATE INDEX "StockMovement_userId_idx" ON "StockMovement"("userId");

CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

CREATE INDEX "CartItem_productId_idx" ON "CartItem"("productId");
CREATE UNIQUE INDEX "CartItem_cartId_productId_key" ON "CartItem"("cartId", "productId");

CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

CREATE INDEX "PaymentAttempt_orderId_createdAt_idx" ON "PaymentAttempt"("orderId", "createdAt");
CREATE UNIQUE INDEX "PaymentAttempt_one_paid_per_order_key"
    ON "PaymentAttempt"("orderId")
    WHERE "status" = 'PAID';

CREATE INDEX "PaymentEvent_paymentAttemptId_createdAt_idx" ON "PaymentEvent"("paymentAttemptId", "createdAt");

-- 6.3 Recreate all 19 Foreign Key constraints (Tier 1 -> Tier 4)
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey"
    FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stocks" ADD CONSTRAINT "stocks_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey"
    FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentAttemptId_fkey"
    FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6.4 Recompile and Restore PaymentEvent Append-Only Trigger for UUID Columns
CREATE OR REPLACE FUNCTION "prevent_payment_event_mutation"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'PaymentEvent records cannot be deleted';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD."actorId" IS NOT NULL
       AND NEW."actorId" IS NULL
       AND ROW(
           OLD."id",
           OLD."paymentAttemptId",
           OLD."eventType",
           OLD."previousStatus",
           OLD."newStatus",
           OLD."actorId",
           OLD."reason",
           OLD."createdAt"
       ) IS NOT DISTINCT FROM ROW(
           NEW."id",
           NEW."paymentAttemptId",
           NEW."eventType",
           NEW."previousStatus",
           NEW."newStatus",
           OLD."actorId",
           NEW."reason",
           NEW."createdAt"
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'PaymentEvent records are append-only; only actorId nullification is permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentEvent_append_only"
BEFORE UPDATE OR DELETE ON "PaymentEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_payment_event_mutation"();

