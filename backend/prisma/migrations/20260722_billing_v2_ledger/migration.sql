-- Billing v2: line items, receipts, revisions, payment immutability columns

-- Invoice expands
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "cachedOutstanding" DECIMAL(12,2);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxLabel" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "packageSnapshot" JSONB;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "customerGstin" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "studioGstin" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "issuedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

-- InvoicePayment expands
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "reference" TEXT;
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "voidedById" TEXT;
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "gatewayProvider" TEXT;
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "gatewayRef" TEXT;
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "gatewayStatus" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "InvoicePayment_studio_idem_uidx"
  ON "InvoicePayment" ("studioId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "InvoicePayment_studio_method_paid_idx"
  ON "InvoicePayment" ("studioId", "method", "paidAt");

CREATE INDEX IF NOT EXISTS "InvoiceInstallment_dueDate_idx"
  ON "InvoiceInstallment" ("dueDate");

CREATE INDEX IF NOT EXISTS "Invoice_studio_customer_idx"
  ON "Invoice" ("studioId", "customerId");

-- Line items
CREATE TABLE IF NOT EXISTS "InvoiceLineItem" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "kind" TEXT NOT NULL DEFAULT 'CUSTOM',
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
  "unitAmount" DECIMAL(12,2) NOT NULL,
  "lineTotal" DECIMAL(12,2) NOT NULL,
  "hsnCode" TEXT,
  CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InvoiceLineItem_invoiceId_sortOrder_idx"
  ON "InvoiceLineItem" ("invoiceId", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "InvoiceLineItem"
    ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Receipt documents (not invoice children)
CREATE TABLE IF NOT EXISTS "Receipt" (
  "id" TEXT NOT NULL,
  "studioId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "pdfKey" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Receipt_studioId_receiptNumber_key"
  ON "Receipt" ("studioId", "receiptNumber");
CREATE INDEX IF NOT EXISTS "Receipt_invoiceId_idx" ON "Receipt" ("invoiceId");
CREATE INDEX IF NOT EXISTS "Receipt_paymentId_idx" ON "Receipt" ("paymentId");

DO $$ BEGIN
  ALTER TABLE "Receipt"
    ADD CONSTRAINT "Receipt_studioId_fkey"
    FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Receipt"
    ADD CONSTRAINT "Receipt_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Receipt"
    ADD CONSTRAINT "Receipt_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "InvoicePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Invoice revisions
CREATE TABLE IF NOT EXISTS "InvoiceRevision" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "InvoiceRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceRevision_invoiceId_revision_key"
  ON "InvoiceRevision" ("invoiceId", "revision");
CREATE INDEX IF NOT EXISTS "InvoiceRevision_invoiceId_idx" ON "InvoiceRevision" ("invoiceId");

DO $$ BEGIN
  ALTER TABLE "InvoiceRevision"
    ADD CONSTRAINT "InvoiceRevision_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill cachedOutstanding from total - amountPaid for existing rows
UPDATE "Invoice"
SET "cachedOutstanding" = GREATEST(0, "totalAmount" - COALESCE("amountPaid", 0))
WHERE "cachedOutstanding" IS NULL AND kind = 'INVOICE';
