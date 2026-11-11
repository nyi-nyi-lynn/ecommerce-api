-- Add normalized, revision-based CMS storage without changing commerce data.

CREATE TYPE "CmsRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "CmsDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(100) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CmsRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documentId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "CmsRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "seoTitle" VARCHAR(70),
    "seoDescription" VARCHAR(160),
    "ogImageUrl" TEXT,
    "ogImagePublicId" TEXT,
    "createdById" UUID,
    "publishedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CmsSection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revisionId" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "content" JSONB NOT NULL,
    "imageUrl" TEXT,
    "imagePublicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CmsSectionItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sectionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(200),
    "body" TEXT,
    "url" TEXT,
    "label" VARCHAR(120),
    "categoryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsSectionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CmsDocument_key_key" ON "CmsDocument"("key");
CREATE UNIQUE INDEX "CmsRevision_documentId_revisionNumber_key" ON "CmsRevision"("documentId", "revisionNumber");
CREATE UNIQUE INDEX "CmsRevision_one_draft_per_document_key" ON "CmsRevision"("documentId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "CmsRevision_one_published_per_document_key" ON "CmsRevision"("documentId") WHERE "status" = 'PUBLISHED';
CREATE INDEX "CmsRevision_documentId_createdAt_idx" ON "CmsRevision"("documentId", "createdAt");
CREATE INDEX "CmsRevision_createdById_idx" ON "CmsRevision"("createdById");
CREATE INDEX "CmsRevision_publishedById_idx" ON "CmsRevision"("publishedById");
CREATE UNIQUE INDEX "CmsSection_revisionId_key_key" ON "CmsSection"("revisionId", "key");
CREATE UNIQUE INDEX "CmsSection_revisionId_position_key" ON "CmsSection"("revisionId", "position");
CREATE UNIQUE INDEX "CmsSectionItem_sectionId_position_key" ON "CmsSectionItem"("sectionId", "position");
CREATE INDEX "CmsSectionItem_categoryId_idx" ON "CmsSectionItem"("categoryId");

ALTER TABLE "CmsRevision"
    ADD CONSTRAINT "CmsRevision_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "CmsDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CmsRevision_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "CmsRevision_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CmsSection"
    ADD CONSTRAINT "CmsSection_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "CmsRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CmsSectionItem"
    ADD CONSTRAINT "CmsSectionItem_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "CmsSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CmsSectionItem_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
