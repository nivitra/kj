-- Multiple enquiries/books keep independent timelines on the same client.
ALTER TABLE "CustomerBooking" ADD COLUMN IF NOT EXISTS "jobs" JSONB NOT NULL DEFAULT '[]';
