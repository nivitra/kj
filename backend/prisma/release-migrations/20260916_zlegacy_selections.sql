-- Preserve billed picks from the old shared-invoice workflow before enabling revisions.
-- No cash, invoice lines or totals are changed by this migration.
UPDATE "SelectionItem" item
SET "editingStartedAt" = COALESCE(s."billedAt", s."overageSyncedAt", s."submittedAt", s."updatedAt")
FROM "Selection" s, "Invoice" inv
WHERE item."selectionId" = s.id AND s."overageInvoiceId" = inv.id
AND inv.status NOT IN ('VOID', 'DRAFT') AND s."pricingSnapshot" IS NULL
AND (s."deliveryStatus" = 'BILLED' OR COALESCE(s."overageAmount", 0) > 0)
AND item."deliveryType" IN ('INCLUDED', 'RAW', 'EDITED');

UPDATE "Selection" s
SET history = COALESCE(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
  'kind', 'LEGACY_BILLING_PRESERVED', 'at', CURRENT_TIMESTAMP,
  'invoiceId', s."overageInvoiceId", 'amount', s."overageAmount",
  'note', 'Prior confirmed photos and shared invoice preserved. Additional photos use a separate invoice.'
)),
"editingStartedAt" = CASE WHEN EXISTS (SELECT 1 FROM "SelectionItem" i WHERE i."selectionId"=s.id AND i."editingStartedAt" IS NOT NULL)
  THEN COALESCE(s."billedAt", s."overageSyncedAt", s."submittedAt", s."updatedAt") ELSE NULL END,
"overageInvoiceId" = NULL
WHERE s."overageInvoiceId" IS NOT NULL AND s."pricingSnapshot" IS NULL;
