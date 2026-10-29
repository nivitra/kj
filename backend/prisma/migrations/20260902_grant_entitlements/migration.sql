ALTER TABLE "AccessGrant" ADD COLUMN IF NOT EXISTS "accessMode" TEXT NOT NULL DEFAULT 'SELECTION';
ALTER TABLE "AccessGrant" ADD COLUMN IF NOT EXISTS "selectionLimit" INTEGER;
ALTER TABLE "AccessGrant" ADD COLUMN IF NOT EXISTS "extraPhotoPrice" DECIMAL(10, 2);
ALTER TABLE "AccessGrant" ADD COLUMN IF NOT EXISTS "downloadEnabled" BOOLEAN;
ALTER TABLE "AccessGrant" ADD COLUMN IF NOT EXISTS "faceSearchEnabled" BOOLEAN;

-- Existing RAW grants become the RAW access mode.
UPDATE "AccessGrant" SET "accessMode" = 'RAW'
WHERE "rawAccess" = true AND ("accessMode" IS NULL OR "accessMode" = 'SELECTION');
