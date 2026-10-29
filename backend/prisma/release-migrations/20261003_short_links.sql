CREATE TABLE IF NOT EXISTS "ShortLink" (
  "id" TEXT PRIMARY KEY,
  "studioId" TEXT NOT NULL REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "token" TEXT NOT NULL,
  "targetHash" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShortLink_token_key" ON "ShortLink"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "ShortLink_studioId_targetHash_key" ON "ShortLink"("studioId", "targetHash");
