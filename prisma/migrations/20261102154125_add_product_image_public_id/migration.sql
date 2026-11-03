-- Add optional Cloudinary public ID while preserving existing imageUrl values.
ALTER TABLE "Product" ADD COLUMN "imagePublicId" TEXT;
