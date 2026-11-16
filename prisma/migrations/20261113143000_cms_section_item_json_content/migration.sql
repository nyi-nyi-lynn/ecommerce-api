-- Convert CmsSectionItem fixed columns into a dynamic JSONB content object
-- while preserving all existing records, IDs, section relationships, positions,
-- and timestamps.

ALTER TABLE "CmsSectionItem"
    ADD COLUMN "content" JSONB;

UPDATE "CmsSectionItem"
SET "content" = COALESCE(
    jsonb_strip_nulls(
        jsonb_build_object(
            'title', "title",
            'body', "body",
            'url', "url",
            'label', "label",
            'categoryId', "categoryId"::text
        )
    ),
    '{}'::jsonb
);

ALTER TABLE "CmsSectionItem"
    ALTER COLUMN "content" SET NOT NULL;

ALTER TABLE "CmsSectionItem"
    DROP CONSTRAINT "CmsSectionItem_categoryId_fkey";

DROP INDEX "CmsSectionItem_categoryId_idx";

ALTER TABLE "CmsSectionItem"
    DROP COLUMN "title",
    DROP COLUMN "body",
    DROP COLUMN "url",
    DROP COLUMN "label",
    DROP COLUMN "categoryId";
