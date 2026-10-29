# SJ Studio — Invoicing, end to endx

How money moves through the SJ / Warmkelvin studio platform: who creates a bill, what it connects to, how cash is recorded, and what else in the app changes because of it.

This describes the code that is running now (`studio-platform/backend`, admin dashboard, customer app). It is not the July 2026 design draft in `studio-platform/docs/INVOICE-PAYMENT-ARCHITECTURE.md`. Where that draft and the code disagree, the code wins. The important disagreements are called out at the end.

Production hosts:

| Surface | URL |
| --- | --- |
| Customer app (Flutter web) | `https://app.warmkelvin.com` |
| Admin dashboard | `https://admin.warmkelvin.com` |
| API | `https://api.warmkelvin.com` |

Everything is scoped to one `Studio` row. Admins carry `studioId` in their JWT. Customers carry it on `Customer`. Invoice numbers, coupons, receipts, and payment references are unique inside that studio, not globally.

---

## 1. The one rule

**The bill is the invoice. The cash is the payment ledger. The balance is computed. Nothing else is allowed to be the source of truth.**

```
What was sold                         The bill                         The cash
─────────────────                     ────────                         ────────
Quote (accepted)          ─┐
Admin “New invoice”        ├─►  Invoice + InvoiceLineItem  ─►  InvoicePayment (append-only)
Selection extras           │         totalAmount                   PAYMENT / REFUND
Raw-dump purchase         ─┘              │                              │
                                          │                              │
                                          ▼                              ▼
                               outstanding = total − net applied
                                          │
                    ┌─────────────────────┼──────────────────────┐
                    ▼                     ▼                      ▼
           Customer.payment*      FIFO milestone view      Receipt (RCT-…)
           (profile rollup)       (reminders only)         when a PAYMENT lands
                    │                                            │
                    ▼                                            ▼
           Booking job, agreement,                     AccessGrant.rawAccess
           WhatsApp, PDF, short link                   only if a RAW_DUMP line is PAID
```

Cached columns exist so lists stay fast. They are written by the server after the ledger changes. Clients do not set `amountPaid` or `cachedOutstanding` as authority.

| Fact | Source of truth | Cache / display only |
| --- | --- | --- |
| What the client owes | Sum of `InvoiceLineItem.lineTotal`, stored as `Invoice.totalAmount` | `travelAmount`, `discountAmount`, `taxAmount` |
| What has been received | Non-voided `InvoicePayment` rows | `Invoice.amountPaid`, `Invoice.cachedOutstanding` |
| Milestone “paid” | FIFO of net applied across `InvoiceInstallment.amount`, computed on read | `paidAmount`, `status`, `paidAt` on the installment row (dual-written) |
| Client profile totals | Sum of non-draft, non-void invoices | `Customer.paymentTotalDue`, `paymentAmountPaid` |
| Proof of one payment | `Receipt` linked to that payment | PDF regenerated on demand |
| Customer “I paid” | `PaymentClaim` until a manager confirms it | Claim does **not** change the balance |

Money math uses integer paise (`services/billing/money.js`). `Number(decimal) * 100` is not used for authorization.

```
cash in   = Σ PAYMENT (not voided)
cash out  = Σ REFUND  (not voided)
net       = cash in − cash out + historical write-off / round-off / adjustment rows
outstanding = max(0, total − net)
status    = PAID if outstanding is 0, else PARTIALLY_PAID if net > 0, else SENT
```

New payments may only be `PAYMENT` or `REFUND`. `WRITE_OFF`, `ROUND_OFF`, and `ADJUSTMENT` are rejected (“Use Update paid”). Old rows of those kinds still count if they exist. Overpay is not allowed. A refund cannot exceed cash already recorded. Reducing the paid total is done by voiding a receipt or recording a refund, not by editing a payment.

---

## 2. Records and how they point at each other

All of these live in `backend/prisma/schema.prisma`.

| Model | What it is | Points at |
| --- | --- | --- |
| `Invoice` | The bill. `kind` is `INVOICE`. Number `INV-YYYY-####`. | `Customer`, optional `ServicePackage`, optional parent (legacy receipts only) |
| `InvoiceLineItem` | One priced row. Kinds: `PACKAGE`, `ADDON`, `TRAVEL`, `DISCOUNT`, `TAX`, `CUSTOM`. | `Invoice` |
| `InvoiceInstallment` | Optional reminder (“Advance 50%”, “Event day 50%”). Not cash. | `Invoice` |
| `InvoicePayment` | One immutable cash movement. `installmentId` is always null on new rows. | `Invoice`, optional installment (legacy), `Receipt` |
| `Receipt` | Proof document `RCT-YYYY-####`, one per payment. Status `ACTIVE` or `VOID`. | `Invoice`, `InvoicePayment` |
| `InvoiceRevision` | JSON snapshot taken before a revise or a customer coupon. | `Invoice` |
| `BillingSequence` | Atomic per-studio, per-year counter for `INV-` numbers. | `Studio` |
| `Coupon` / `CouponRedemption` | Catalog code and the one redemption tied to an invoice (`invoiceId` unique). | `Customer`, optional package |
| `PaymentClaim` | Customer report of a UPI/bank payment. Unique `(studioId, reference)`. Status `PENDING`, `CONFIRMED`, `REJECTED`. | `Invoice`, optional `paymentId` after confirm |
| `Customer` | Rollup fields `paymentTotalDue` / `paymentAmountPaid` recomputed from open invoices. | Many invoices |
| `Quote` | After convert, `formData.invoiceId` and `agreementId`. | Invoice created at convert |
| `WeddingAgreement` | `formData.invoiceId` and `totalFee` copied from the accepted quote. Terms text only — accepting the agreement does not post cash. | Same customer |
| `CustomerBooking.jobs[]` | JSON job from convert carries `invoiceId`, `agreementId`, status `AWAITING_ADVANCE`. | Not a foreign key; stored inside the booking JSON |
| `Selection` | `overageInvoiceId` after the client submits extras. | That invoice |
| `EventGallery` | `bulkRawInvoiceId` after a raw-dump request. | That invoice |
| `AccessGrant` | `rawInvoiceId`, `rawAccess` flipped on when that raw-dump invoice is `PAID`, and off again if it stops being paid (and the grant was not given by an admin). | Invoice |
| `ShortLink` | Stable `/l/<token>` to `/invoices?id=` or `/billing`. Does not grant extra permission. | App route, checked against a live non-draft invoice |

`kind = RECEIPT` invoices (child rows with `parentInvoiceId`) are legacy. New code does not create them. Customer and admin lists hide them. Payments cannot be recorded on them.

Invoice numbers come from `services/billing/invoiceNumber.js`: insert-or-increment `BillingSequence` for the studio and calendar year, then `INV-2026-0001`. Receipt numbers are separate (`RCT-2026-0001`) and use a Postgres advisory lock, not `BillingSequence`.

---

## 3. Status of an invoice

| Status | Meaning | Who can see it |
| --- | --- | --- |
| `DRAFT` | Admin created it. Not on the client app. Coupon may be attached but is not redeemed yet. | Admin only |
| `SENT` | Issued. `finalizedAt`, `issuedAt`, and `sentAt` are set. This is the normal open state, including “finalized, nothing paid yet”. | Admin and that customer |
| `PARTIALLY_PAID` | Ledger net is above zero and below the total. | Both |
| `PAID` | Outstanding is zero. | Both |
| `VOID` | Cancelled. Only if there is no live payment and `amountPaid` is 0. A draft is hard-deleted instead of voided. | Hidden from the customer list (`status: { not: 'DRAFT' }` still returns voids on get-by-id; the list query does not filter `VOID`) |

`FINALIZED` is not stored as the steady state. `deriveStatus` maps an open finalized invoice to `SENT` once `sentAt` or `finalizedAt` is set.

Payments are refused until `finalizedAt` is set. Quote conversion, selection extras, and raw-dump requests create the invoice already `SENT` and finalized, so they can be paid immediately.

---

## 4. Four ways an invoice is born

### 4.1 Admin creates one by hand

Screen: admin `/dashboard/invoices` → **New invoice**.

1. Pick a real client (`isGuest: false`). Guests cannot be billed here.
2. Optional `ServicePackage`. The package price is only a default for the total. Later edits to the catalog do not rewrite this invoice. A snapshot of the package is stored at finalize.
3. Optional travel amount. The API treats `totalAmount` as the service amount and adds travel.
4. Optional coupon code. Discount is computed now and stored as a negative `DISCOUNT` line. The coupon is **not** redeemed until finalize.
5. Optional installment rows (0–12). Empty is allowed. If rows exist, their amounts are reminders. The grand total is service + travel − discount, not “whatever the rows add up to” when a service total was given.
6. `POST /api/admin/billing/invoices` writes a `DRAFT` with `PACKAGE`, `TRAVEL`, and `DISCOUNT` lines.
7. The same screen can immediately call finalize (`POST /api/admin/billing/invoices/:id/finalize`).

Finalize, inside a row lock:

- Rejects a void invoice and a negative total.
- If `finalizedAt` is already set, returns the invoice unchanged.
- Redeems the coupon (`redeemCoupon`): locks the coupon row, checks the discount still matches, writes `CouponRedemption`, increments `redemptionCount`.
- Copies `package` into `packageSnapshot` if none was stored.
- Sets `SENT` / `PARTIALLY_PAID` / `PAID` from money already on the row, plus `finalizedAt`, `issuedAt`, `sentAt`.
- Recomputes the customer rollup.

Until finalize, `PUT /api/admin/billing/invoices/:id` can still change title, notes, terms, package, total, travel, and the installment plan. After finalize, money and the plan are frozen on that PUT. Use revise (below). Notes, title, and terms can still be updated. Setting `status: VOID` through this PUT is still accepted by the handler; the dedicated delete route is the one that checks for live payments first.

### 4.2 An accepted quotation is converted

This is the main sales path. Details of the quote itself are in `SJ-END-TO-END-OPERATIONS.md`. The money hand-off is `convertQuote` in `services/billing/quoteLifecycle.js`, called by `POST /api/admin/quotes/:id/convert`. Owner or manager only.

Preconditions: quote status is `APPROVED` (client or admin already picked one option). A second convert of the same quote returns the existing invoice and agreement and does not create another.

Inside one transaction:

1. Lock the quote.
2. Build lines from `pricingSnapshot.lines` (`OPTION` becomes `PACKAGE`, add-ons become `ADDON`) plus a `TAX` line when tax is greater than zero.
3. `createSentInvoice` (`services/billing/issueAndNotify.js`) with `fiftyFifty: true`. That writes a **SENT, already finalized** invoice and two milestones: **Advance (50%)** and **Event day (50%)**. Terms come from the quote, else the studio profile terms, else the default payment terms.
4. Store the accepted package option on `packageSnapshot`.
5. Create a `WeddingAgreement` in `DRAFT` whose `formData` holds `invoiceId`, `totalFee`, package name, and the payment-terms text. The agreement is not a second bill.
6. Upsert `CustomerBooking` and append a job `{ source: 'QUOTATION', status: 'AWAITING_ADVANCE', invoiceId, agreementId, quoteId, leadId, … }`. Placeholder jobs already on the booking are dropped when the helper says the list is still a placeholder.
7. If the quote came from a lead that is not already `BOOKED`, set that lead to `inquiryStatus: APPROVED`, `status: WON`.
8. Mark the quote `CONVERTED` and store `invoiceId` / `invoiceNumber` on `formData`.
9. Recompute the customer rollup.

Paying the advance does **not** automatically move the booking job off `AWAITING_ADVANCE`. The job status and the invoice status are written at convert time and then live separately. Staff move the job on the bookings screen.

`notifyInvoiceWhatsApp` (PDF + “invoice is ready” document) exists in the same file and is **not called** by convert or by any route. Convert does not WhatsApp the invoice by itself. Payment recording later does fire WhatsApp templates (section 7).

### 4.3 The client submits extra photos

Path: customer gallery → hearts → `POST /api/selections/my/:galleryId/submit` → `submitSelection` in `services/selectionWorkflow.js`.

Included photos are free. Photos past the included limit are extras at the gallery or grant rate. Only extras that are **not** already locked for editing are priced.

- No overage invoice yet and extras cost more than zero: `createSentInvoice` with one `ADDON` line, title `Photo selection — <gallery name>`. Already `SENT`.
- An overage invoice already exists and the total changed: snapshot an `InvoiceRevision`, replace the line, recompute outstanding from the existing ledger. If the new total is below what was already paid, the note records a credit and says no cash refund was posted. The code does not auto-refund.
- A void overage invoice is ignored and a new one can be created.
- `Selection.overageInvoiceId` points at that invoice. Submitting the same photo set again is a no-op.

When the studio starts editing (`POST /api/admin/selections/:id/start-editing`), locked photos stay billed as they were. The client can still add more photos; the next submit revises the open overage invoice. Reopening clears the current overage pointer back to the previous editing batch’s invoice.

A second, older helper `syncSelectionOverageInvoice` in `services/selectionOverage.js` is **not called by any route**. The live submit path is `submitSelection`.

After classification, the studio can bill a different way: `POST /api/admin/selections/:id/bill` → `billClassifiedSelection` in `services/selectionDelivery.js`. That finds the client’s best open invoice (`findBestInvoice`) and writes add-on lines marked `[SEL_EDIT:…]` (and legacy `[SEL_RAW:…]`). Those lines change `totalAmount`. The customer account timeline still looks for the older marker `[SEL_OVERAGE:` when it builds the “extra photos” event, so a line created only by `submitSelection` (description `Extra photos — …`, no marker) will not show up as a `SELECTION_OVERAGE` timeline row. The invoice total itself is still correct.

### 4.4 The client buys the full raw gallery

Path: gallery detail → `POST /api/galleries/my/:id/raw-dump` → `requestRawDump` in `services/rawDump.js`.

Rules:

- The grant must be live, the gallery published, and the offer window open (`isOfferLive`). If raw is already unlocked, the request is rejected.
- If this gallery already has `bulkRawInvoiceId` or any non-void invoice whose line contains `[RAW_DUMP:<galleryId>]`, that invoice is reused.
- Otherwise a new `SENT` invoice is created: title `All originals — <gallery name>`, one `ADDON` line, price `gallery.bulkRawPrice`, due date = gallery expiry when set.

When any payment path recomputes the invoice and the status is `PAID`, `fulfillRawDumpIfPaid` runs:

- It only looks at line descriptions matching `[RAW_DUMP:…]`.
- For each gallery, if the customer still has a live access grant and raw was **not** granted by an admin (`rawGrantedByAdminId` is null), it sets `rawAccess: true` and `rawInvoiceId`.
- If the invoice is no longer `PAID`, it turns `rawAccess` back off for grants that were opened by this invoice (again, not ones an admin granted by hand).

Admin can also turn raw access on or off directly (`POST/DELETE /api/galleries/:id/raw-access`). That path does not create an invoice.

---

## 5. What the admin does after the bill exists

Screen: `/dashboard/invoices`. Confirmations of customer-reported UPI payments are a different screen: `/dashboard/payments`.

All non-GET billing routes require `OWNER` or `MANAGER`. Staff can read invoices. `recordPayment`, revise, and void also check the role inside the service.

| Action | API | Effect |
| --- | --- | --- |
| List / open | `GET /api/admin/billing/invoices`, `GET …/:id` | Projected DTO from `projectInvoice` (totals, FIFO plan, payments, receipts). |
| Edit draft | `PUT …/:id` | Money and plan only while `DRAFT`. |
| Finalize | `POST …/:id/finalize` | Issues the bill. Redeems coupon. |
| Record a payment | `POST …/:id/payments` | Body: `amount`, `method` (`CASH`, `UPI`, `BANK`, `CARD`, `CHEQUE`, `OTHER`), `reference`, `note`, `paidAt`, `idempotencyKey`, `kind` (`PAYMENT` or `REFUND`). |
| Set “paid so far” | `PUT …/:id/paid` | Computes the delta from current cash and records one `PAYMENT`. Refuses a lower number. |
| Void a payment | `POST …/:id/payments/:paymentId/void` | Sets `voidedAt`. Voids the receipt. Recomputes. Does not delete the row. |
| Hard-delete a payment | `DELETE …/:id/payments/:paymentId` | **410** unless `BILLING_ALLOW_HARD_DELETE=true`. The admin UI’s delete calls void, not this. |
| Revise | `POST …/:id/revise` | For a finalized, non-void invoice. Snapshot, replace lines and optionally milestones, recompute. New total cannot be changed out from under the rules in `reviseService` (drafts and voids are rejected; use the draft PUT instead). |
| Void or delete the invoice | `DELETE …/:id` | Refuses when any non-void payment exists or `amountPaid` > 0. Draft is deleted. Anything else becomes `VOID` with `voidReason`. Then raw-dump fulfillment is rechecked and the customer rollup is rebuilt. |
| PDF | `GET …/:id/pdf` | `buildInvoicePdf`, upload to S3 `studios/<studioId>/invoices/<id>/invoice.pdf`, return a signed URL (and the buffer payload the route already returns). |
| Receipt PDF | `GET /api/admin/billing/receipts/:receiptId/pdf` | Same document the customer can fetch. |
| Studio summary | `GET /api/admin/billing/summary` | Per-customer billed / paid / balance from the projected invoices. |
| Payment claims | `GET /api/admin/billing/payment-claims`, `POST …/:id/review` | See section 6. |
| Coupons | `GET/POST/PATCH/DELETE /api/admin/billing/coupons` | Catalog only. Applying is on the invoice. |

`POST …/payments` locks the invoice row (`SELECT … FOR UPDATE`), rejects drafts and voids, and replays a repeated `idempotencyKey` when the invoice, amount, kind, and reference match. A reused key with different facts returns 409.

If an old invoice has `amountPaid` set but **no** ledger rows, the first new payment inserts an opening `PAYMENT` (`method: LEGACY`, note “Opening balance imported…”, key `opening:<invoiceId>`) so that historical cash is not dropped.

Each successful new `PAYMENT` creates a `Receipt` unless `BILLING_RECEIPTS=false` or the body says `issueReceipt: false`.

After the ledger write:

- `amountPaid` and `cachedOutstanding` and `status` are updated from `computeMoney`.
- If `BILLING_DUAL_WRITE` is not `false` (default on), installment `paidAmount` / `status` are rewritten as a FIFO mirror. They are still not the source of truth.
- `recomputeCustomerRollup` sets the client’s `paymentTotalDue` and `paymentAmountPaid` to the sum of invoices that are not `DRAFT`, not `VOID`, and not legacy receipts. Credit on one invoice is **not** applied to another.
- `fulfillRawDumpIfPaid` runs.
- WhatsApp `INVOICE_INSTALLMENT_PAID` and `PAYMENT_RECORDED` fire when the customer has a phone (section 7). Failures are swallowed.

Sharing: the invoice card uses `ShareLinkButton` with path `/invoices?id=<id>` for anything that is not a draft. That becomes `https://app.warmkelvin.com/l/<16-char token>`. The resolver (`services/shortLinks.js`) only redirects if that invoice is still not `DRAFT` and not `VOID`. The link does not log the client in and does not expose other invoices.

There is also a legacy body on `PUT …/:id`: `markInstallmentPaid`. It still inserts a ledger row **with** `installmentId` and does not go through `recordPayment` (no row lock, no receipt, no “must be finalized” check). The current invoices screen records payments through `POST …/payments`, not this body. Treat `markInstallmentPaid` as a leftover.

---

## 6. What the client does

Screens: `/invoices` and `/billing` in the Flutter app (`invoices_screen.dart`, `upi_payment_sheet.dart`). Drafts are never returned.

| Action | API | Effect |
| --- | --- | --- |
| Account home | `GET /api/billing/account` | Summary, invoices, a money timeline, and a “waiting for the studio to send an invoice” flag when a package is requested and no invoice exists. |
| List / open | `GET /api/billing/invoices`, `GET …/:id` | Same projection as admin, without customer PII expansion. |
| PDF | `GET …/:id/pdf` | Same generator, only for this customer’s non-draft invoice. |
| Receipt PDF | `GET /api/billing/receipts/:receiptId/pdf` | Only if the receipt’s invoice belongs to this customer and is not a draft. |
| Payment instructions | `GET …/:id/payment-options` | Signed QR from `StudioProfile.paymentQrKey`, `upiId`, payee name, and this customer’s claims. |
| Report a payment | `POST …/:id/payment-claims` | Creates `PaymentClaim`. **Does not change the balance.** |
| Apply a coupon | `POST …/:id/apply-coupon` | Only before any payment. See section 8. |
| Check a code | `POST /api/billing/coupons/validate` | Preview only. |
| Apply a code with no invoice | `POST /api/billing/coupons/apply` | Always 400. The coupon has to land on an invoice. |

The UPI sheet builds `upi://pay?pa=<upiId>&pn=<studio>&cu=INR&am=<amount>&tn=<invoiceNumber>`, opens the device payment app, then asks for the UTR / reference (6–120 characters). A repeated report of the same reference, amount, and invoice returns the existing claim. The same reference on a different invoice or amount is 409.

Confirm or reject is admin-only (`reviewPayment`):

- Approve locks the claim, calls `recordPayment` with `method: UPI`, `idempotencyKey: claim:<id>`, note “Studio verified customer payment report”, then marks the claim `CONFIRMED` and stores `paymentId`.
- Reject requires a note and marks `REJECTED`. No ledger row.
- A claim that is already decided is returned as-is.

So the client never writes the ledger. The studio does, either by typing the payment or by confirming the claim.

Customer status copy is plain language (`customerInvoiceStatusLabel`), not the raw enum: “₹X due”, “Partially paid — ₹A of ₹B”, or “Nothing due”.

---

## 7. WhatsApp, PDF, and S3

| Event | What is sent | Where |
| --- | --- | --- |
| Payment recorded (`POST …/payments`, kind `PAYMENT`, not a replay) | Templates `INVOICE_INSTALLMENT_PAID` and `PAYMENT_RECORDED`. Variables: name, invoice number, amount, balance, currency, method. | `routes/billing.js` → `whatsapp.triggerAuto` |
| Paid-total updated and a new payment row was created | `PAYMENT_RECORDED` only. | same |
| Legacy `markInstallmentPaid` | `INVOICE_INSTALLMENT_PAID` | same |
| `notifyInvoiceWhatsApp` | Would upload the PDF and send it as a document, then fire `INVOICE_SENT`. | **Defined, never called.** |
| Invoice or receipt PDF download | File generated by `services/invoicePdf.js` / receipt PDF helper, stored in S3, signed URL returned. | Admin and customer GET routes |

Studio name, phone, address, and terms on the PDF come from `StudioProfile`, with fallbacks in `loadStudioMeta` (`SJ Clicks and Films`, `Nanded, Maharashtra`, tagline `Studio by Warmkelvin`).

Outbound messages can be silenced with `DISABLE_OUTBOUND_NOTIFICATIONS`.

---

## 8. Coupons

Catalog: admin `/dashboard/coupons`. `PERCENT` or `FIXED`, optional minimum amount, redemption cap, date window, and an optional list of `ServicePackage` ids (empty means all packages). One redemption per customer. Stored discount is snapshotted; later edits to the coupon do not rewrite an invoice that already redeemed it.

Two apply paths:

1. **Admin, at draft create.** Discount is baked into the total and a `DISCOUNT` line. Redemption happens at finalize. If the coupon’s terms no longer match the stored discount, finalize fails and the draft must be updated.
2. **Customer, on an issued invoice** (`applyInvoiceCoupon`). Refused when a coupon is already on the invoice, when any payment exists, or when the invoice is draft or void. It writes a revision snapshot, adds a `DISCOUNT` line, rescales tax in proportion, rescales installment amounts to the new total, redeems immediately, and recomputes the rollup.

`packageIds` on the coupon is compared to `Invoice.packageId`. A selection-only or raw-dump invoice often has no package, so a package-restricted coupon will not apply to it.

---

## 9. Installments are a picture, not a purse

`allocateFifo` (`services/billing/allocate.js`) walks milestones in `sortOrder` and pours **net applied** into them until each planned amount is covered. The API returns that as `plan.milestones`, `plan.nextDue`, and a legacy `installments[]` with `status` `PAID` / `PARTIAL` / `PENDING`.

Rules that matter:

- A payment is not stored against an installment (new rows keep `installmentId` null).
- You can pay any amount up to the outstanding balance. It does not have to match the next milestone.
- If the plan sums to less than the invoice total, the remainder is an implicit unscheduled bucket (`plan.unscheduled`).
- The 50/50 plan from quote conversion is only this picture. The first real rupee still lands in the ledger, then the picture fills Advance first.

`BILLING_DUAL_WRITE` (default on) copies that picture back onto `InvoiceInstallment.paidAmount` so older screens do not show zeros. If those columns and the ledger ever disagree, trust the ledger.

---

## 10. Revise

`POST /api/admin/billing/invoices/:id/revise` (owner or manager). Used for a package change after the invoice was issued.

- Locks the invoice. Refuses `DRAFT`, `VOID`, and legacy receipts.
- Writes `InvoiceRevision` with the previous total, lines, installments, and package snapshot.
- Replaces line items from the body. Server owns the totals.
- Milestones: `KEEP`, or replace, according to `milestonesMode`.
- Recomputes status from the **existing** ledger against the new total. Payments are not deleted.
- Updates the customer rollup.

If the new total is lower than cash already received, outstanding goes to zero and `overpay` shows on the projection. The code does not move that credit onto another invoice.

---

## 11. Connection map (everything that touches an invoice)

```
Public quotation request ─► Lead ─► Quote (SENT) ─► accept ─► APPROVED
                                                              │
                              admin POST /quotes/:id/convert  │
                                                              ▼
                         ┌──────────── Invoice (SENT, 50/50) ────────────┐
                         │                    │                          │
                         ▼                    ▼                          ▼
              WeddingAgreement DRAFT    Booking job              Customer rollup
              formData.invoiceId        AWAITING_ADVANCE         paymentTotalDue
                         │                    │
                         ▼                    ▼
              Contract PDF later        Admin moves job by hand
              (does not post cash)      (does not post cash)

Admin “New invoice” ─► DRAFT ─► finalize ─► SENT ─► same ledger from here down

Gallery hearts ─► submit selection ─► Invoice ADDON “Extra photos”
                                      Selection.overageInvoiceId
Admin classify ─► bill ─► ADDON lines [SEL_EDIT:galleryId] on the best open invoice

Gallery “all originals” ─► Invoice ADDON [RAW_DUMP:galleryId]
                           EventGallery.bulkRawInvoiceId
                           on PAID ─► AccessGrant.rawAccess = true
                           on unpaid again ─► rawAccess false (unless an admin granted it)

Customer UPI sheet ─► PaymentClaim (PENDING)
                      admin confirm ─► InvoicePayment (UPI) + Receipt
                      admin reject ─► claim REJECTED, balance unchanged

Admin “Record payment” ─► InvoicePayment + Receipt
                          ├─► status / caches
                          ├─► FIFO milestone mirror
                          ├─► customer rollup
                          ├─► raw dump fulfill
                          └─► WhatsApp PAYMENT_RECORDED

Share button ─► ShortLink /l/<token> ─► app /invoices?id=
               hidden again if invoice is draft or void

PDF download ─► invoicePdf.js ─► S3 studios/<id>/invoices/<invoiceId>/invoice.pdf
```

Things that look like billing but are **not** this ledger:

| Thing | What it actually is |
| --- | --- |
| `Payment` model and `/api/admin/payments`, `/api/orders` | Old frame-shop orders. Decimal money, separate table. No admin or app screen uses it as the studio bill. |
| `Customer.paymentTerms` | Free text on the profile. Not computed from the invoice. |
| Agreement “payment terms” | Paragraph copied onto the agreement and the invoice `terms` field. Signing does not record money. |
| Gallery “mark as paid” / download toggle | Entitlement flags on the gallery or grant. Independent of invoice status, except raw-dump as described above. |
| `services/otp.js` email/SMS | Not on this path. |

---

## 12. API index

Mounted in `backend/src/index.js`:

- Admin: `/api/admin/billing` → `routes/billing.js` `adminRouter` (admin JWT, writes need owner/manager).
- Customer: `/api/billing` → `customerRouter` (customer session).

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/admin/billing/summary` | Admin |
| GET/POST | `/api/admin/billing/coupons` | Admin |
| PATCH/DELETE | `/api/admin/billing/coupons/:id` | Admin |
| GET | `/api/admin/billing/payment-claims` | Admin |
| POST | `/api/admin/billing/payment-claims/:id/review` | Admin |
| GET/POST | `/api/admin/billing/invoices` | Admin |
| GET/PUT/DELETE | `/api/admin/billing/invoices/:id` | Admin |
| PUT | `/api/admin/billing/invoices/:id/paid` | Admin |
| POST | `/api/admin/billing/invoices/:id/payments` | Admin |
| POST | `/api/admin/billing/invoices/:id/payments/:paymentId/void` | Owner, manager |
| DELETE | `/api/admin/billing/invoices/:id/payments/:paymentId` | Disabled (410) unless hard-delete flag |
| POST | `/api/admin/billing/invoices/:id/revise` | Owner, manager |
| POST | `/api/admin/billing/invoices/:id/finalize` | Admin |
| GET | `/api/admin/billing/invoices/:id/pdf` | Admin |
| GET | `/api/admin/billing/receipts/:receiptId/pdf` | Admin |
| GET | `/api/billing/account` | Customer |
| GET | `/api/billing/invoices` | Customer |
| GET | `/api/billing/invoices/:id` | Customer |
| GET | `/api/billing/invoices/:id/pdf` | Customer |
| GET | `/api/billing/invoices/:id/payment-options` | Customer |
| POST | `/api/billing/invoices/:id/payment-claims` | Customer |
| POST | `/api/billing/invoices/:id/apply-coupon` | Customer |
| POST | `/api/billing/coupons/validate` | Customer |
| POST | `/api/billing/coupons/apply` | Always rejected |
| GET | `/api/billing/receipts/:receiptId/pdf` | Customer |

Related routes that create or point at invoices, but are not under `/billing`:

| Method | Path | Creates / uses |
| --- | --- | --- |
| POST | `/api/admin/quotes/:id/convert` | Invoice + agreement + booking job |
| POST | `/api/selections/my/:galleryId/submit` | Selection overage invoice |
| POST | `/api/admin/selections/:id/bill` | Add-on lines on an existing invoice |
| POST | `/api/galleries/my/:id/raw-dump` | Raw-dump invoice |
| POST | `/api/admin/links` and `/api/links` | Short link to `/invoices` or `/billing` |

Admin client: `admin-dashboard/src/lib/api.ts` (`listInvoices`, `createInvoice`, `finalizeInvoice`, `recordPayment`, `reviseInvoice`, `invoicePdf`, …). Customer client: `customer-app/lib/services/api_service.dart` and `upi_payment_sheet.dart`.

---

## 13. Code map

| Piece | File |
| --- | --- |
| HTTP | `backend/src/routes/billing.js` |
| Ledger write, void, set-paid, recompute | `backend/src/services/billing/paymentService.js` |
| Paise math and status | `backend/src/services/billing/money.js` |
| FIFO plan | `backend/src/services/billing/allocate.js` |
| API shape | `backend/src/services/billing/projectInvoice.js` |
| Draft-to-sent helper used by quotes, selections, and (internally) notify | `backend/src/services/billing/issueAndNotify.js` |
| Invoice numbers | `backend/src/services/billing/invoiceNumber.js` |
| Receipts | `backend/src/services/billing/receiptService.js` |
| Revise | `backend/src/services/billing/reviseService.js` |
| Coupons | `backend/src/services/billing/couponService.js` |
| Customer UPI claims | `backend/src/services/billing/paymentClaims.js` |
| Profile totals | `backend/src/services/billing/customerRollup.js` |
| Account headline | `backend/src/services/billing/accountSummary.js` |
| Quote → invoice | `backend/src/services/billing/quoteLifecycle.js` |
| Flags | `backend/src/services/billing/flags.js` |
| Installment mirror | `backend/src/services/billing/dualWrite.js` |
| PDF | `backend/src/services/invoicePdf.js` |
| Selection submit | `backend/src/services/selectionWorkflow.js` |
| Selection classify / bill | `backend/src/services/selectionDelivery.js` |
| Raw dump | `backend/src/services/rawDump.js` |
| Schema | `backend/prisma/schema.prisma` (`Invoice` through `InvoiceRevision`, `BillingSequence`, `PaymentClaim`) |
| Admin UI | `admin-dashboard/src/app/dashboard/invoices/page.tsx`, `…/payments/page.tsx`, `…/coupons/page.tsx` |
| Customer UI | `customer-app/lib/screens/invoices_screen.dart`, `customer-app/lib/widgets/upi_payment_sheet.dart` |
| Tests | `backend/tests/billing-money.test.js`, `billing-account.test.js`, plus quote and selection integration tests |

Flags (all default to the safe production path):

| Env | Default | Meaning |
| --- | --- | --- |
| `BILLING_V2` | on | Redesign path. `false` turns it off. `BILLING_V2_STUDIO_IDS` can limit it. |
| `BILLING_RECEIPTS` | on | Create `Receipt` rows. |
| `BILLING_DUAL_WRITE` | on | Mirror FIFO onto installment columns. |
| `BILLING_ALLOW_HARD_DELETE` | off | Allow deleting ledger rows. Leave this off. |

---

## 14. Where the July design draft is already done, and where it is not

Done in code: ledger as source of truth, paise math, optional milestones, FIFO display, receipts as their own table, line items, package snapshot at finalize, idempotency keys, soft-void, customer rollup across invoices, role check on billing writes, payment claims instead of the client posting cash.

Not done, or different from that draft:

- No Razorpay / PayU / Stripe capture. Gateway columns on `InvoicePayment` are unused. The client pays by UPI deep link or QR and the studio confirms.
- `WRITE_OFF` / `ROUND_OFF` / `ADJUSTMENT` cannot be posted anymore, even though the draft allowed them and the money function still sums old rows.
- `notifyInvoiceWhatsApp` is unused, so issuing an invoice does not by itself push a PDF on WhatsApp. Payment templates do fire.
- `markInstallmentPaid` can still insert a ledger row outside `recordPayment`.
- `syncSelectionOverageInvoice` is unused. Live selection billing is `submitSelection` plus `billClassifiedSelection`.
- Booking job status does not follow the invoice. `AWAITING_ADVANCE` stays until someone updates the job.
- One invoice’s overpay is not a wallet for the next invoice.
- Frame-shop `Payment` is still in the schema and is a different system.
