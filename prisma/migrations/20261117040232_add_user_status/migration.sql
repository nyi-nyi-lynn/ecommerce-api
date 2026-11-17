-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- Backfill existing inactive users so status stays synchronized with isActive
UPDATE "User" SET "status" = 'DEACTIVATED' WHERE "isActive" = false;

