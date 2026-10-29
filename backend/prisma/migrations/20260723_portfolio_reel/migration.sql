-- Instagram Reels / external links on portfolio works
ALTER TABLE "PortfolioItem" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT;
