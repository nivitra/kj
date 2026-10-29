-- Face/share full access
ALTER TABLE "GalleryShareLink" ADD COLUMN IF NOT EXISTS "fullAccessCodeHash" TEXT;
ALTER TABLE "GalleryGuest" ADD COLUMN IF NOT EXISTS "fullAccess" BOOLEAN NOT NULL DEFAULT false;

-- Gallery media (videos)
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "mediaType" TEXT NOT NULL DEFAULT 'IMAGE';
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "posterKey" TEXT;
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;
CREATE INDEX IF NOT EXISTS "Photo_galleryId_mediaType_idx" ON "Photo"("galleryId", "mediaType");
CREATE INDEX IF NOT EXISTS "Photo_galleryId_filename_idx" ON "Photo"("galleryId", "filename");

-- Invoice receipts
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'INVOICE';
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "parentInvoiceId" TEXT;
CREATE INDEX IF NOT EXISTS "Invoice_parentInvoiceId_idx" ON "Invoice"("parentInvoiceId");
DO $$ BEGIN
  ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_parentInvoiceId_fkey"
    FOREIGN KEY ("parentInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
