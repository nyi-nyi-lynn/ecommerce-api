-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- Drop existing default so the type can be altered cleanly
ALTER TABLE "Order" ALTER COLUMN "paymentStatus" DROP DEFAULT;

-- AlterTable: Convert Order.paymentStatus to the dedicated OrderPaymentStatus enum
ALTER TABLE "Order" ALTER COLUMN "paymentStatus" TYPE "OrderPaymentStatus" USING ("paymentStatus"::text::"OrderPaymentStatus");

-- Restore default value using the new enum
ALTER TABLE "Order" ALTER COLUMN "paymentStatus" SET DEFAULT 'PENDING';

