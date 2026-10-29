# UX Guide: Billing, Money & Deliverables

**Product:** SJ Studio / Warmkelvin (studio-platform)  
**Surfaces:** Admin dashboard (`admin.warmkelvin.com`) · Customer app (Flutter web/mobile)  
**Scope:** Everything related to money, packages, invoices, payments, coupons, photo selections/overage charges, downloads, and delivery status — from both **admin** and **client** sides.  
**Last updated:** 2026-07-23

---

## 1. Mental model (one sentence)

**Package (what was sold) → Invoice (the bill) → Payments (cash ledger) → Outstanding (computed) → Deliverables unlocked by studio (selections, downloads, booking stages).**

Money truth is the **invoice + payment ledger**.  
Deliverables (hearts, submitted selections, downloads, booking timeline) are **product unlocks** the studio controls; some (extra selections) **write back into money** automatically.

```
┌──────────────────┐     assign / sell      ┌─────────────────┐
│ Service package  │ ─────────────────────► │ Client booking  │
│ (marketing + ₹)  │                        │ + timeline      │
└────────┬─────────┘                        └────────┬────────┘
         │                                           │
         │  create invoice                           │ status history
         ▼                                           ▼
┌──────────────────┐   optional schedule   ┌─────────────────┐
│ Invoice          │ ◄── milestones ────── │ Reminders only  │
│ line items + total│                      └─────────────────┘
└────────┬─────────┘
         │ record cash / round-off
         ▼
┌──────────────────┐     FIFO display      ┌─────────────────┐
│ Payment ledger   │ ───────────────────► │ Progress / plan │
└────────┬─────────┘                      └─────────────────┘
         │
         ▼
   Outstanding = Total − cash paid

Deliverables (parallel, linked):
  Gallery → hearts (selection) → submit → [extras] → ADDON on invoice
  Gallery → Downloads on/off (admin) → client download originals
  Booking steps → “Ready for delivery” / “Delivered”
```

---

## 2. Money objects (what people see)

| Concept | Admin sees | Client sees | Notes |
|--------|------------|-------------|--------|
| **Service package** | Packages (CMS): title, price, features, booking steps | Packages tab + gallery package picker | Marketing / job package (`ServicePackage`) |
| **Pricing tier / client package** | Pricing tiers: included photos, ₹/extra, base fee | Indirect (drives selection limits) | Selection/overage engine (`ClientType`) |
| **Invoice** | Invoices list + create/edit/finalize/PDF | Payments screen: list + detail | Numbered `INV-YYYY-####` |
| **Milestones** | Optional installment rows (Booking advance, Final…) | “Plan” progress if present | Reminders only; not cash SoT |
| **Payment** | Record payment modal (UPI/Cash/…) | Paid / remaining / progress bar | Immutable ledger |
| **Coupon** | Coupons admin | Apply code on open invoice | Discount on invoice |
| **Selection overage** | Selection detail + invoice ADDON line | Soft-limit banner + submit dialog | Auto-billed on submit |
| **Downloads** | Gallery “Downloads on/off” | Download buttons when allowed | Independent of “Mark as paid” flag |
| **Agreement** | Client agreement PDF + payment terms text | Contracts screen | Legal terms; not auto-ledger |

---

## 3. Admin UX

### 3.1 Navigation (money & deliverables)

| Sidebar | Purpose |
|---------|---------|
| **Command Center** | Outstanding ₹, collected, tasks with dues |
| **Clients** | Package assignment, payment terms, profile totals, link to selections/invoices |
| **Invoices** | Full billing workspace |
| **Coupons** | Discount codes |
| **Packages** (service) | Sellable packages + default booking steps + price |
| **Pricing tiers** | Included photo counts + ₹ per extra (selection) |
| **Galleries** | Selection limit, downloads, payment flag, purpose |
| **Selections** | Review client picks + overage invoice link |
| **Bookings** | Job progress / delivery stages |
| **Agreements** (per client) | Contract + payment schedule text |

---

### 3.2 Invoices (primary money surface)

**Route:** `/dashboard/invoices`

#### List & overview
- Summary chips: **Outstanding**, collected-style totals (from billing summary API).
- **Clients with open balance** strip — quick jump to who still owes.
- Invoice rows show:
  - Number, title, client, package name
  - Status: `DRAFT` · `SENT` · `FINALIZED` · `PARTIALLY_PAID` · `PAID` · `VOID`
  - **Balance** (what still matters operationally)
  - Actions: **Record payment** (if balance &gt; 0), PDF, open/edit

#### Create invoice
1. Pick **client**
2. Optionally pick **service package** (fills price/title snapshot context)
3. **Service total** + optional **travel**
4. Optional **milestone plan** (count, labels, amounts; “split evenly” helper)
   - Defaults: Booking advance · Installment N · Final balance
5. Notes / terms free text
6. Save:
   - Draft path, or
   - Create & send (studio workflow may toast “Finalize to send”)

**UX rule:** After finalize, totals are locked; structural package changes go through **Revise** (admin API), not casual edit of total.

#### Record payment
Modal on the same invoice:
- Default amount = remaining balance
- Kind: **PAYMENT** | **ROUND_OFF** | **WRITE_OFF** (and related ledger kinds in API)
- Method: UPI · Cash · Bank · Card · Cheque · Other
- Reference + note
- Optional **allow overpay**
- Milestones (if any) show FIFO fill automatically — admin does **not** need to pick which installment cash hits for correctness

#### PDF & receipts
- **PDF** opens/downloads the invoice document
- Payment history visible on the invoice; receipts are documents tied to payments (ledger-first model)

#### What admin should do day-to-day
1. Create one invoice per job/client engagement  
2. Record every cash movement as a payment on that invoice  
3. Use round-off for leftover paise; write-off for waived balance  
4. Never “edit paid amount” by hand — always ledger  

---

### 3.3 Coupons

**Route:** `/dashboard/coupons`

- Create codes: percent or fixed, min order, max redemptions, optional package scope, dates  
- Client applies code on **SENT** (eligible) invoices in the app  
- Admin sees discount reflected on invoice (`couponCode`, `discountAmount`)

---

### 3.4 Service packages (sellable / booking)

**Route:** `/dashboard/service-packages` (and related Packages CMS)

Admin configures:
- Title, description, cover  
- **Price** / discount price  
- Feature list  
- **Default booking steps** (e.g. Enquiry → … → Ready for delivery → Delivered)  
- Featured flag  

**UX link to money:** choosing this package on an invoice / booking ties the job to a price and a delivery timeline.

---

### 3.5 Pricing tiers (selection & overage)

**Route:** `/dashboard/pricing-packages` (“Client packages” / pricing tiers)

Admin configures:
- Base fee  
- **Included photos** (free selection count)  
- **₹ per extra photo** (product default in forms: **₹350**)  
- Workflow: selection-only vs selection + download  

Assigned to **clients** (and optionally to galleries). This is the engine behind selection soft limits.

---

### 3.6 Client profile (money context)

**Route:** `/dashboard/clients/[id]`

Relevant blocks:
- **Assigned pricing package** — included photos + ₹/extra summary  
- **Payment terms** free text (shown to client conceptually via studio process)  
- **Payment total due / amount paid** studio-entered summary fields (legacy denorm; live truth still invoices)  
- Tabs: galleries, agreements, **selections**, notes  
- Create/open invoices for this client from Invoices surface  

---

### 3.7 Galleries (deliverables + money hooks)

**Route:** `/dashboard/galleries/[id]`

| Control | UX meaning |
|---------|------------|
| **Publish** | Client can see gallery (with grant) |
| **Downloads on / off** | Client may download originals (independent of payment flag) |
| **Mark as paid** | Operational flag only — **does not** auto-enable downloads |
| **Photo selection limit** | Free count override for this gallery |
| **₹ per extra photo** | Overage rate override (blank → package → studio → ₹350) |
| **Purpose** | SELECTION vs DELIVERY vs GENERAL (hides selection UI for pure delivery) |
| **Face search** | Guest/client find-me (not billing) |

**Save selection pricing** writes gallery overrides used by the live estimate API.

---

### 3.8 Selections (deliverable review + overage)

**Route:** `/dashboard/selections` · detail `/dashboard/selections/[id]`

Admin sees:
- Client, gallery, count, status (`SUBMITTED` / `OPEN` / `UNLOCKED`)  
- Grid of chosen photos  
- Export **CSV** of filenames (for editors)  
- **Unlock for client** if they must re-pick  
- Estimate: included limit, extras, ₹ overage  
- If billed: link to **invoice number** and balance  

**On client submit (backend):**  
extras → `ADDON` line on best matching open invoice (or new invoice) + booking history note.

---

### 3.9 Bookings (delivery stages)

**Route:** `/dashboard/bookings`

- Job progress tracker (completed / current / upcoming stages)  
- Custom stages can merge into one timeline  
- Status changes can trigger WhatsApp templates  
- Selection overage appends a **history chip/note** without inventing a random status  

Typical delivery-related stages (package defaults):  
`Editing` → `Ready for delivery` → `Delivered`

---

### 3.10 Agreements (contract money language)

**Route:** `/dashboard/clients/[id]/agreement`

- Payment schedule / terms as **text** in the wedding agreement PDF  
- Not automatic ledger entries — legal framing for what invoices will collect  

---

### 3.11 Command Center (money at a glance)

- **Collected** / **Outstanding** metrics  
- Tasks: “N clients with outstanding dues” → Invoices  
- Pipeline + job updates (operational, not cash)

---

## 4. Customer app UX

### 4.1 How clients reach money & deliverables

| Entry | Location |
|-------|----------|
| **Packages** | Main tab |
| **Payments / invoices** | Drawer → Payments (`/invoices`) |
| **My galleries** | Gallery tab |
| **Selection review** | Gallery → Review & submit |
| **Booking status** | Drawer → Booking status |
| **Agreements** | Drawer → Agreements |
| **Downloads** | Gallery / photo viewer when studio enabled downloads |

---

### 4.2 Packages tab

- Browse studio **service packages** (price, features, cover)  
- Request / select a package (signals studio; may set `requestedPackageId`)  
- Not a checkout cart — studio confirms and invoices offline  

---

### 4.3 Payments (Invoices) screen

**Screen title feel:** “Invoices” / payments account

#### List
- Optional **summary**: total billed, paid, remaining (glass/stat cards)  
- Each invoice card: title, number, status, **progress bar** (paid ÷ total), balance  

#### Detail
- Invoice number, title, status  
- **Paid** / **Remaining** / total (plain language — no PARTIAL/WAIVED jargon in primary UI)  
- Line items when present (package, add-ons, selection overage)  
- Milestone plan display if studio set one (visual progress)  
- **Coupon** field when eligible (typically unpaid / sent invoices)  
- **View PDF** (in-app viewer or download)  

#### Coupon apply
1. Open invoice detail  
2. Enter code → Apply  
3. Toast: saved amount + final amount  
4. Detail refreshes  

Clients **cannot** record payments themselves — studio records cash offline.

---

### 4.4 Galleries & photo selection (deliverable + money)

#### Browsing
- Heart/favorite photos when selection is enabled  
- If selection is **submitted**, hearts are locked until studio unlocks  

#### Soft limit (critical UX)
- Limit comes from: gallery override → client pricing package → studio defaults  
- **Never hard-blocks** extra hearts  
- When over limit, client sees messaging like:

  > You've selected N photos (limit M). You can keep selecting — each extra photo is ₹350. Currently X extra = ₹Y.

- Banner on gallery bottom bar; snackbar when crossing the line; full copy on Review screen  

#### Review & submit
1. Open **Review & submit**  
2. See count, free vs extras, ₹ total for extras  
3. Confirm dialog if extras: **Submit & add extras** — explains auto-invoice  
4. Success: count submitted; if billed, shows invoice number  

#### Downloads
- Visible only when admin set **Downloads on** for that gallery  
- Single photo download + bulk “Download” for visible set  
- **Not** automatically tied to invoice PAID status (studio chooses unlock)  

---

### 4.5 Guest share (relatives)

- QR / link: name + phone, optional face match  
- Full gallery unlock via studio **access code**  
- Download depends on share/gallery rules  
- No personal invoice UI for pure guests  

---

### 4.6 Booking status (delivery progress)

- Single timeline of stages from package / studio  
- Current step highlighted; history chips  
- WhatsApp may notify on status change  
- Selection overage may appear as a history note on the studio side  

---

### 4.7 Contracts / agreements

- List agreements, view PDF, accept when required  
- Payment terms are contractual context; pay flow remains Invoices  

---

## 5. End-to-end journeys

### Journey A — Classic job invoice

```
Admin: assign package → create invoice (service + travel + milestones)
     → finalize/send → client sees invoice in Payments
Admin: receive UPI ₹40k → Record payment
     → balance drops; status → PARTIALLY_PAID
Admin: more payments → PAID
Admin: toggle gallery Downloads on when ready to deliver files
Admin: move booking → Ready for delivery → Delivered
```

### Journey B — Selection overage (₹350 extras)

```
Admin: set package “20 included, ₹350/extra” (or gallery override)
Client: hearts 28 photos
App: “8 extras × ₹350 = ₹2,800 — you can keep selecting”
Client: Submit selection
System: ADDON line on existing client invoice (or new invoice)
      + booking history note + selection snapshot
Admin: Selections detail shows invoice link
Client: Payments shows higher balance
Admin: Record payment for extras (or full remaining)
```

### Journey C — Coupon

```
Admin: create code SAVE10 (10%)
Client: open invoice → Apply SAVE10
Invoice discount applied; remaining updates
```

### Journey D — Delivery-only gallery

```
Admin: purpose = DELIVERY, Downloads on, selection off
Client: browse + download; no hearts / review flow
```

---

## 6. Status cheat-sheet

### Invoice status (admin + client-facing)

| Status | Meaning in UX |
|--------|----------------|
| `DRAFT` | Studio only; not ready for client |
| `SENT` / `FINALIZED` | Client should see; can pay (offline) |
| `PARTIALLY_PAID` | Some cash applied |
| `PAID` | Outstanding ≈ 0 |
| `VOID` | Cancelled; ignore for balance |

### Selection status

| Status | Client | Admin |
|--------|--------|-------|
| `OPEN` | Can heart | — |
| `SUBMITTED` | Locked | Export / unlock / see overage invoice |
| `UNLOCKED` | Can heart again | After unlock action |

### Gallery delivery flags

| Flag | Client effect |
|------|----------------|
| Published + grant | Gallery visible |
| Selection enabled | Hearts + review |
| Downloads on | Original download |
| Payment complete | Admin ops flag only |

---

## 7. Pricing resolution (selection)

Most specific wins:

1. **Gallery** `selectionLimit` / `extraPhotoPrice`  
2. **Client pricing package** (`ClientType`) included + ₹/extra  
3. **Studio pricing settings**  
4. **Defaults:** free count from settings/package; **₹350** per extra if rate unset  

Explicit **₹0**/extra = free unlimited extras (studio choice).

---

## 8. What is intentionally *not* automatic

| Expectation | Actual product rule |
|-------------|---------------------|
| Invoice PAID auto-enables downloads | **No** — admin toggles Downloads |
| Client pays online in-app | **No** — offline cash; admin records ledger |
| Package price alone is the invoice | **No** — invoice is explicit; package is default/helper |
| Over-limit hearts blocked | **No** — soft limit + charge |
| Agreement terms create ledger rows | **No** — text only until invoice exists |
| Guest share creates client invoice | **No** |

---

## 9. Roles (admin)

| Action | Typical role |
|--------|----------------|
| Create invoice, record PAYMENT | Admin / staff |
| Void / write-off / revise package total | Manager+ (enforced in billing services where gated) |
| Coupons, packages, gallery pricing | Studio ops |
| Unlock selection | Studio ops |

---

## 10. Screen map (quick reference)

### Admin
| Path | UX focus |
|------|----------|
| `/dashboard` | Outstanding, dues tasks |
| `/dashboard/invoices` | Create, pay, PDF, balance |
| `/dashboard/coupons` | Discount codes |
| `/dashboard/service-packages` | Sellable packages + delivery steps |
| `/dashboard/pricing-packages` | Selection included + ₹/extra |
| `/dashboard/clients/[id]` | Package, terms, selections link |
| `/dashboard/clients/[id]/agreement` | Contract payment language |
| `/dashboard/galleries/[id]` | Limit, extras ₹, downloads |
| `/dashboard/selections/[id]` | Review picks + overage invoice |
| `/dashboard/bookings` | Delivery stage tracker |

### Customer
| Path / entry | UX focus |
|--------------|----------|
| Packages tab | Browse / request package |
| Drawer → Payments | Invoices, coupon, PDF |
| Gallery detail | Hearts, limit banner, download |
| Selection review | Confirm extras + submit |
| Booking status | Delivery timeline |
| Contracts | Agreement accept / view |

---

## 11. Copy bank (client-facing, money)

Use calm, complete sentences:

- **Within limit:** “12 of 20 included photos selected · 8 remaining free”  
- **Over limit:** “You can keep selecting — each extra photo is ₹350. Currently 3 extra = ₹1,050.”  
- **Submit with extras:** “3 extras will be added to your studio invoice.”  
- **After submit:** “28 photos sent. 3 extras (₹1,050) added to invoice INV-2026-0042.”  
- **Payments list:** “Paid / Remaining” not “PARTIAL installment WAIVED”  
- **Downloads off:** hide or disable download; no fake “pay to unlock” unless studio messaging elsewhere  

---

## 12. Implementation anchors (for engineers)

| Area | Location |
|------|----------|
| Invoice UI (admin) | `admin-dashboard/src/app/dashboard/invoices/page.tsx` |
| Billing API | `backend/src/routes/billing.js` + `backend/src/services/billing/*` |
| Selection pricing | `backend/src/services/pricing.js` |
| Overage → invoice | `backend/src/services/selectionOverage.js` |
| Selection API | `backend/src/routes/selection.js` |
| Client payments UI | `customer-app/lib/screens/invoices_screen.dart` |
| Client selection UX | `gallery_detail_screen.dart`, `selection_review_screen.dart` |
| Architecture deep-dive | `docs/INVOICE-PAYMENT-ARCHITECTURE.md` |

---

## 13. Checklist for studio operators

1. Create **pricing tier** (included photos + ₹350 extras) and assign to client  
2. Create **service package** with price + delivery steps  
3. Create **invoice** when booking is confirmed; record every payment  
4. Open gallery; set selection limit if this job differs from package  
5. After client submits selection, check **Selections** + invoice ADDON  
6. When finals are ready: **Downloads on** + booking → Delivered  
7. Use coupons sparingly on SENT invoices  

---

*This document describes product UX as implemented in studio-platform as of the date above. Cash is ledger-first; deliverables are studio-controlled; selection extras are the main automatic money bridge from client actions into invoices.*
