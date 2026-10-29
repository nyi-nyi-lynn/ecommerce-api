ALTER TABLE "StockMovement"
ADD COLUMN "orderId" INTEGER;

CREATE INDEX "StockMovement_orderId_idx"
ON "StockMovement"("orderId");

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "OrderItem_orderId_idx"
ON "OrderItem"("orderId");