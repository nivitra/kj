-- Unread indicator for submitted selections until admin opens them.
ALTER TABLE "Selection" ADD COLUMN IF NOT EXISTS "adminOpenedAt" TIMESTAMP(3);
