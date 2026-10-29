-- Gallery cover crop + bulk RAW FOMO offer
ALTER TABLE "EventGallery" ADD COLUMN IF NOT EXISTS "coverPhotoId" TEXT;
ALTER TABLE "EventGallery" ADD COLUMN IF NOT EXISTS "coverCrop" JSONB;
ALTER TABLE "EventGallery" ADD COLUMN IF NOT EXISTS "bulkRawEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EventGallery" ADD COLUMN IF NOT EXISTS "bulkRawPrice" DECIMAL(12, 2);
ALTER TABLE "EventGallery" ADD COLUMN IF NOT EXISTS "bulkRawWindowDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "EventGallery" ADD COLUMN IF NOT EXISTS "bulkRawInvoiceId" TEXT;

-- Selection lock metadata (extras vs included reopen)
ALTER TABLE "Selection" ADD COLUMN IF NOT EXISTS "includedLockedAt" TIMESTAMP(3);
ALTER TABLE "Selection" ADD COLUMN IF NOT EXISTS "unlockMode" TEXT NOT NULL DEFAULT 'NONE';
