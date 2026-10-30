-- Extend the existing payment enums without changing existing Order values.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MANUAL';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'GATEWAY';

ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TABLE "PaymentAttempt" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "providerCode" VARCHAR(50),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MMK',
    "transactionReference" VARCHAR(255),
    "proofUrl" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "reviewedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentAttempt_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "PaymentAttempt_reference_provider_check"
        CHECK ("transactionReference" IS NULL OR "providerCode" IS NOT NULL)
);

CREATE TABLE "PaymentEvent" (
    "id" SERIAL NOT NULL,
    "paymentAttemptId" INTEGER NOT NULL,
    "eventType" VARCHAR(50) NOT NULL,
    "previousStatus" "PaymentStatus",
    "newStatus" "PaymentStatus" NOT NULL,
    "actorId" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentAttempt_orderId_createdAt_idx"
ON "PaymentAttempt"("orderId", "createdAt");

CREATE INDEX "PaymentAttempt_status_createdAt_idx"
ON "PaymentAttempt"("status", "createdAt");

CREATE INDEX "PaymentAttempt_providerCode_transactionReference_idx"
ON "PaymentAttempt"("providerCode", "transactionReference");

CREATE UNIQUE INDEX "PaymentAttempt_providerCode_transactionReference_key"
ON "PaymentAttempt"("providerCode", "transactionReference")
WHERE "providerCode" IS NOT NULL AND "transactionReference" IS NOT NULL;

CREATE UNIQUE INDEX "PaymentAttempt_one_paid_per_order_key"
ON "PaymentAttempt"("orderId")
WHERE "status" = 'PAID';

CREATE INDEX "PaymentEvent_paymentAttemptId_createdAt_idx"
ON "PaymentEvent"("paymentAttemptId", "createdAt");

ALTER TABLE "PaymentAttempt"
ADD CONSTRAINT "PaymentAttempt_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAttempt"
ADD CONSTRAINT "PaymentAttempt_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentEvent"
ADD CONSTRAINT "PaymentEvent_paymentAttemptId_fkey"
FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentEvent"
ADD CONSTRAINT "PaymentEvent_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep audit history immutable. The only allowed update is the FK-driven
-- actorId nullification when a referenced User is deleted.
CREATE FUNCTION "prevent_payment_event_mutation"() RETURNS trigger AS $$
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

-- Row-level triggers do not fire for TRUNCATE, so block it explicitly.
CREATE FUNCTION "prevent_payment_event_truncate"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'PaymentEvent records cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentEvent_no_truncate"
BEFORE TRUNCATE ON "PaymentEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_payment_event_truncate"();
