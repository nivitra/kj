-- Invoice travelling charges (line item; included in totalAmount)
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "travelAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0;
