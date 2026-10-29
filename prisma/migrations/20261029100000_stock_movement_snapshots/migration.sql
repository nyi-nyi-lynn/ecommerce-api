-- Preserve existing inventory and movement rows while adding audit details.
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'INITIALIZATION';

ALTER TABLE "stocks"
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD CONSTRAINT "stocks_quantity_invariant_check"
        CHECK (
            "quantity" >= 0
            AND "reservedQuantity" >= 0
            AND "reservedQuantity" <= "quantity"
        ) NOT VALID;

ALTER TABLE "StockMovement"
    ADD COLUMN "quantityBefore" INTEGER,
    ADD COLUMN "quantityAfter" INTEGER,
    ADD CONSTRAINT "StockMovement_quantity_snapshot_check"
        CHECK (
            ("quantityBefore" IS NULL AND "quantityAfter" IS NULL)
            OR (
                "quantityBefore" >= 0
                AND "quantityAfter" >= 0
                AND "quantityAfter"::BIGINT - "quantityBefore"::BIGINT = "quantity"::BIGINT
            )
        ) NOT VALID;
