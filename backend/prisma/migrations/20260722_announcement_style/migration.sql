-- Announcement display style + optional CTA for client banner/popup UX
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "style" TEXT NOT NULL DEFAULT 'FEED';
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "ctaLabel" TEXT;
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "ctaUrl" TEXT;
