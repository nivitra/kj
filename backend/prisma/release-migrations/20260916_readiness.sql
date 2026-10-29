-- AlterTable
ALTER TABLE "AccessGrant" ADD COLUMN     "rawInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "CouponRedemption" ADD COLUMN     "invoiceId" TEXT;

-- AlterTable
ALTER TABLE "Selection" ADD COLUMN     "editingStartedAt" TIMESTAMP(3),
ADD COLUMN     "pricingSnapshot" JSONB,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SelectionItem" ADD COLUMN     "editingStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StudioProfile" ADD COLUMN     "paymentQrKey" TEXT,
ADD COLUMN     "upiId" TEXT;

-- CreateTable
CREATE TABLE "BillingSequence" (
    "studioId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "BillingSequence_pkey" PRIMARY KEY ("studioId","year")
);

-- CreateTable
CREATE TABLE "PaymentClaim" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentClaim_studioId_status_idx" ON "PaymentClaim"("studioId", "status");

-- CreateIndex
CREATE INDEX "PaymentClaim_invoiceId_idx" ON "PaymentClaim"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentClaim_studioId_reference_key" ON "PaymentClaim"("studioId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_invoiceId_key" ON "CouponRedemption"("invoiceId");

-- Freeze agreed gallery pricing separately from later catalog edits.
ALTER TABLE "EventGallery" ADD COLUMN "pricingSnapshot" JSONB;
UPDATE "EventGallery" g SET "pricingSnapshot" = to_jsonb(p)
FROM "ServicePackage" p WHERE p."selectionTierId" = g."clientTypeId" AND p."studioId"=g."studioId"
AND (SELECT count(*) FROM "ServicePackage" p2 WHERE p2."selectionTierId"=g."clientTypeId" AND p2."studioId"=g."studioId")=1;
-- Preserve issued historical amounts and repair only derived lifecycle/summary fields.
UPDATE "Invoice" SET "finalizedAt"=COALESCE("issuedAt","sentAt","createdAt")
WHERE kind='INVOICE' AND status NOT IN ('DRAFT','VOID') AND "finalizedAt" IS NULL;
INSERT INTO "InvoiceLineItem" (id,"invoiceId","sortOrder",kind,description,quantity,"unitAmount","lineTotal")
SELECT gen_random_uuid()::text,i.id,999,'DISCOUNT','Previously recorded invoice discount',1,-i."discountAmount",-i."discountAmount"
FROM "Invoice" i WHERE i.kind='INVOICE' AND i."discountAmount">0
AND NOT EXISTS (SELECT 1 FROM "InvoiceLineItem" l WHERE l."invoiceId"=i.id AND l.kind='DISCOUNT')
AND (SELECT sum(l."lineTotal") FROM "InvoiceLineItem" l WHERE l."invoiceId"=i.id)=i."totalAmount"+i."discountAmount";
UPDATE "Customer" c SET "paymentTotalDue"=r.total,"paymentAmountPaid"=r.paid
FROM (SELECT "customerId",sum("totalAmount") AS total,sum("amountPaid") AS paid FROM "Invoice"
WHERE kind='INVOICE' AND status NOT IN ('DRAFT','VOID') GROUP BY "customerId") r WHERE c.id=r."customerId";
