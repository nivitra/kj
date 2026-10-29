-- Payment ledger: partial payments + round-offs stay on one invoice
CREATE TABLE IF NOT EXISTS "InvoicePayment" (
  "id" TEXT NOT NULL,
  "studioId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "installmentId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
  "amount" DECIMAL(12,2) NOT NULL,
  "method" TEXT,
  "note" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InvoicePayment_invoiceId_paidAt_idx"
  ON "InvoicePayment"("invoiceId", "paidAt");
CREATE INDEX IF NOT EXISTS "InvoicePayment_studioId_paidAt_idx"
  ON "InvoicePayment"("studioId", "paidAt");
CREATE INDEX IF NOT EXISTS "InvoicePayment_installmentId_idx"
  ON "InvoicePayment"("installmentId");

DO $$ BEGIN
  ALTER TABLE "InvoicePayment"
    ADD CONSTRAINT "InvoicePayment_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InvoicePayment"
    ADD CONSTRAINT "InvoicePayment_installmentId_fkey"
    FOREIGN KEY ("installmentId") REFERENCES "InvoiceInstallment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
