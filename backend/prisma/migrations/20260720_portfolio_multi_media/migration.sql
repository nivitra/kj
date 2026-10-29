-- Multiple media items per portfolio "work"
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "PortfolioMedia" (
  "id" TEXT NOT NULL,
  "portfolioItemId" TEXT NOT NULL,
  "mediaKey" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
  "caption" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortfolioMedia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PortfolioMedia_portfolioItemId_sortOrder_idx"
  ON "PortfolioMedia"("portfolioItemId", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "PortfolioMedia"
    ADD CONSTRAINT "PortfolioMedia_portfolioItemId_fkey"
    FOREIGN KEY ("portfolioItemId") REFERENCES "PortfolioItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: existing single mediaKey/coverKey become first media row
INSERT INTO "PortfolioMedia" ("id", "portfolioItemId", "mediaKey", "mediaType", "sortOrder", "createdAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  COALESCE(p."mediaKey", p."coverKey"),
  COALESCE(p."mediaType", 'IMAGE'),
  0,
  p."createdAt"
FROM "PortfolioItem" p
WHERE COALESCE(p."mediaKey", p."coverKey") IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "PortfolioMedia" m WHERE m."portfolioItemId" = p."id"
  );
