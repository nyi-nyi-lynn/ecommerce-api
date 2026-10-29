-- CartItem quantity must be positive. Before applying this migration, run:
-- SELECT COUNT(*) FROM "CartItem" WHERE "quantity" <= 0;
-- Resolve any invalid rows deliberately before adding the constraint.
ALTER TABLE "CartItem"
ADD CONSTRAINT "CartItem_quantity_positive_check" CHECK ("quantity" > 0);
