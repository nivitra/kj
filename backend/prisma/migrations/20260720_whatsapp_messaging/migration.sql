-- WhatsApp session + templates + outbound logs

CREATE TABLE IF NOT EXISTS "WhatsAppSession" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "phoneNumber" TEXT,
    "displayName" TEXT,
    "lastQrAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "autoSendEnabled" BOOLEAN NOT NULL DEFAULT true,
    "typingMinMs" INTEGER NOT NULL DEFAULT 15000,
    "typingMaxMs" INTEGER NOT NULL DEFAULT 20000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppSession_studioId_key" ON "WhatsAppSession"("studioId");

CREATE TABLE IF NOT EXISTS "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "trigger" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppTemplate_studioId_key_key" ON "WhatsAppTemplate"("studioId", "key");
CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_studioId_active_idx" ON "WhatsAppTemplate"("studioId", "active");
CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_studioId_trigger_idx" ON "WhatsAppTemplate"("studioId", "trigger");

CREATE TABLE IF NOT EXISTS "WhatsAppMessageLog" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateKey" TEXT,
    "campaignId" TEXT,
    "toPhone" TEXT NOT NULL,
    "toName" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "meta" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppMessageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhatsAppMessageLog_studioId_createdAt_idx" ON "WhatsAppMessageLog"("studioId", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppMessageLog_studioId_status_idx" ON "WhatsAppMessageLog"("studioId", "status");
CREATE INDEX IF NOT EXISTS "WhatsAppMessageLog_campaignId_idx" ON "WhatsAppMessageLog"("campaignId");

CREATE TABLE IF NOT EXISTS "WhatsAppCampaign" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT,
    "templateId" TEXT,
    "templateKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "WhatsAppCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhatsAppCampaign_studioId_createdAt_idx" ON "WhatsAppCampaign"("studioId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "WhatsAppSession" ADD CONSTRAINT "WhatsAppSession_studioId_fkey"
    FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_studioId_fkey"
    FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppMessageLog" ADD CONSTRAINT "WhatsAppMessageLog_studioId_fkey"
    FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppMessageLog" ADD CONSTRAINT "WhatsAppMessageLog_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppMessageLog" ADD CONSTRAINT "WhatsAppMessageLog_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "WhatsAppCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_studioId_fkey"
    FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "WhatsAppSession" ADD COLUMN IF NOT EXISTS "dailyTouchpointLimit" INTEGER NOT NULL DEFAULT 80;
