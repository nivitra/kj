-- Soft-delete / recycle bin for galleries (30-day S3 purge)
ALTER TABLE "EventGallery" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "EventGallery" ADD COLUMN IF NOT EXISTS "purgeAt" TIMESTAMP(3);
ALTER TABLE "EventGallery" ADD COLUMN IF NOT EXISTS "deletedByAdminId" TEXT;

CREATE INDEX IF NOT EXISTS "EventGallery_studioId_deletedAt_idx" ON "EventGallery"("studioId", "deletedAt");
CREATE INDEX IF NOT EXISTS "EventGallery_purgeAt_idx" ON "EventGallery"("purgeAt");
