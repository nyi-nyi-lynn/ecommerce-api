-- Simplify the development CMS from document -> revision -> section to
-- document -> section. The approved development database contains no CMS
-- content. Abort if that precondition is not true so content is never silently
-- discarded by this migration.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "CmsDocument")
       OR EXISTS (SELECT 1 FROM "CmsRevision")
       OR EXISTS (SELECT 1 FROM "CmsSection")
       OR EXISTS (SELECT 1 FROM "CmsSectionItem") THEN
        RAISE EXCEPTION 'CMS simplification requires empty CmsDocument, CmsRevision, CmsSection, and CmsSectionItem tables';
    END IF;
END $$;

CREATE TYPE "CmsDocumentStatus" AS ENUM ('DRAFT', 'PUBLISHED');

ALTER TABLE "CmsDocument"
    ADD COLUMN "status" "CmsDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN "seoTitle" VARCHAR(70),
    ADD COLUMN "seoDescription" VARCHAR(160),
    ADD COLUMN "ogImageUrl" TEXT,
    ADD COLUMN "ogImagePublicId" TEXT,
    ADD COLUMN "publishedAt" TIMESTAMP(3),
    ADD COLUMN "createdById" UUID,
    ADD COLUMN "publishedById" UUID;

ALTER TABLE "CmsSection"
    DROP CONSTRAINT "CmsSection_revisionId_fkey";

DROP INDEX "CmsSection_revisionId_key_key";
DROP INDEX "CmsSection_revisionId_position_key";

ALTER TABLE "CmsSection"
    RENAME COLUMN "revisionId" TO "documentId";

ALTER TABLE "CmsSection"
    ADD CONSTRAINT "CmsSection_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "CmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CmsSection_documentId_key_key" ON "CmsSection"("documentId", "key");
CREATE UNIQUE INDEX "CmsSection_documentId_position_key" ON "CmsSection"("documentId", "position");

ALTER TABLE "CmsSectionItem"
    DROP CONSTRAINT "CmsSectionItem_sectionId_fkey",
    ADD CONSTRAINT "CmsSectionItem_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "CmsSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CmsDocument"
    ADD CONSTRAINT "CmsDocument_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "CmsDocument_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CmsDocument_status_updatedAt_idx" ON "CmsDocument"("status", "updatedAt");
CREATE INDEX "CmsDocument_createdById_idx" ON "CmsDocument"("createdById");
CREATE INDEX "CmsDocument_publishedById_idx" ON "CmsDocument"("publishedById");

DROP TABLE "CmsRevision";
DROP TYPE "CmsRevisionStatus";
