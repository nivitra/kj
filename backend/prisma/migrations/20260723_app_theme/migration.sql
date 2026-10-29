-- Customer app color theme controlled from admin Settings
ALTER TABLE "StudioProfile" ADD COLUMN IF NOT EXISTS "appTheme" TEXT NOT NULL DEFAULT 'warm';
ALTER TABLE "StudioProfile" ADD COLUMN IF NOT EXISTS "appThemeMode" TEXT NOT NULL DEFAULT 'system';
