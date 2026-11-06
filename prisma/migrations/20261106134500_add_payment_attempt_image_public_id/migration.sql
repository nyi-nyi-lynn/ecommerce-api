-- Add optional Cloudinary public ID for manual payment proof images.
ALTER TABLE "PaymentAttempt" ADD COLUMN "imagePublicId" TEXT;

