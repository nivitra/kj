# Admin dashboard — complete UX map

**Product:** SJ Clicks and Films · Studio by Warmkelvin  
**App:** Next.js admin (`admin-dashboard`)  
**Layout:** Sticky left sidebar (menu + signed-in admin) · main content (max ~6xl) · global upload HUD when uploads run  
**Auth:** Login required; session rehydrates from localStorage so refresh stays signed in  

---

## Shell & navigation

| Element | Detail |
|--------|--------|
| **Logo / studio name** | Sidebar top; studio display name + “Studio by Warmkelvin” |
| **Admin chip** | Bottom: avatar initial, name, email, **Sign out** |
| **Roles** | OWNER / MANAGER / STAFF (billing refunds/voids gated MANAGER+) |

### Sidebar menu (order)

| # | Label | Route | Purpose |
|---|--------|--------|---------|
| 1 | Overview | `/dashboard` | Stats + quick actions |
| 2 | Customers | `/dashboard/clients` | CRM list |
| 3 | Galleries | `/dashboard/galleries` | Event collections |
| 4 | Upload | `/dashboard/upload` | Bulk photo upload |
| 5 | Messaging | `/dashboard/messaging` | WhatsApp |
| 6 | Studio profile | `/dashboard/studio` | Public brand CMS |
| 7 | Packages | `/dashboard/service-packages` | Marketing packages |
| 8 | Portfolio | `/dashboard/portfolio` | Our Work |
| 9 | Announcements | `/dashboard/announcements` | Home banners |
| 10 | Booking status | `/dashboard/bookings` | Job pipeline for clients |
| 11 | Billing | `/dashboard/invoices` | Invoices + payments |
| 12 | Coupons | `/dashboard/coupons` | Discount codes |
| 13 | Enquiries | `/dashboard/leads` | Leads from app |
| 14 | Selections | `/dashboard/selections` | Client photo picks |
| 15 | Pricing tiers | `/dashboard/pricing-packages` | ClientType / workflow packages |
| 16 | Jobs | `/dashboard/jobs` | Dead-letter / retries |
| 17 | Team | `/dashboard/team` | Admin users |
| 18 | Settings | `/dashboard/settings` | Workspace |

*(Also exists: `/dashboard/packages` — older client-packages UI, same family as pricing tiers.)*

---

## 1. Overview (`/dashboard`)

**Header:** Greeting by time of day + admin first name  

**Stat cards (clickable where noted)**

| Stat | Goes to |
|------|---------|
| Clients | Customers |
| Submitted selections | Selections |
| Galleries | Galleries |
| Photographs | — (count only) |
| Uploads · last 7 days | Upload |

**Quick actions**

- New client  
- Selections  
- New gallery  
- Upload photos  

**Getting started checklist**

1. Add a client with their email or phone number.  
2. Create a gallery for their shoot or event.  
3. Upload the photographs — previews generate automatically.  
4. Grant the client access, then publish.  

---

## 2. Customers (`/dashboard/clients`)

**List**

| Info shown | Actions |
|------------|---------|
| Name, phone, email, package, status | Search by name/phone |
| | **New client** |

**New client modal fields**

| Field | Notes |
|--------|--------|
| Full name * | Required |
| Phone * | Required (WhatsApp-friendly) |
| Email | Optional |
| Status banner | Free text shown on client app |
| Client package | Pricing tier (ClientType) |
| Password | Optional; auto if blank |
| Notes | Internal |
| Agreement title + PDF | Optional upload at create |

**After create:** Credential share modal (login id / password)

---

## 3. Customer detail (`/dashboard/clients/[id]`)

One place for the full client relationship.

### Identity & access

| Block | Info / fields | Actions |
|--------|----------------|---------|
| Header | Name, phone, email, account status | Back to list |
| Status banner | Text shown on customer home | Save |
| Contact | Name, phone | Edit contact modal |
| Account | Cognito / login, enabled flag | Reset password, Disable/Enable, Delete |
| Credentials | Login id | View Cognito details |

### Package & payment (profile summary)

| Field | Notes |
|--------|--------|
| Assigned package | ClientType select |
| Requested package | If client asked for one |
| Payment total due | ₹ (rollup / manual) |
| Amount paid | ₹ |
| Payment terms | Free text for client |
| Internal notes | Studio only |

### Gallery access

| Info | Actions |
|------|---------|
| Gallery name, grant date, expiry | **Grant gallery access** (multi-select galleries) |
| | Revoke grant |

### Agreements

| Type | Statuses | Actions |
|------|----------|---------|
| Wedding form | DRAFT / FINALIZED | **Make agreement**, **Edit** / **Edit again**, View PDF, Client copy |
| Uploaded PDF | Contract | Upload PDF, View, Open tab |

**Wedding agreement wizard** (`…/agreement?id=…`) — sections:

1. Parties & contacts  
2. Event details  
3. Package  
4. Day-wise coverage (multi-day, services, venue, times)  
5. Deliverables & scope  
6. Delivery timeline  
7. Photographer responsibilities  
8. Package cost & payment  
9. Terms & special conditions  
10. Review & finalize → PDF  

Drafts editable; finalized can be **Edit again** → re-finalize new PDF.

---

## 4. Galleries (`/dashboard/galleries`)

**List**

| Shown | Actions |
|--------|---------|
| Name, status, photo count, downloads on/off | Search / filter |
| | **New gallery** |
| | Toggle downloads |

**New gallery fields (typical)**  
Name, description, event date, client type / workflow, face search, watermark, download enabled, etc.

### Gallery detail (`/dashboard/galleries/[id]`)

| Area | Info & controls |
|------|------------------|
| **Header** | Name, status DRAFT/PUBLISHED, photo counts |
| **Settings** | Publish, downloads on/off, payment complete flag, face search on/off, cover photo, watermark |
| **Photos grid** | Thumb, processing status, video badge; set cover; download original; delete |
| **Upload** | In-page / link to bulk upload |
| **Share / QR** | Create share link, label, visit/guest counts, full-access code, revoke |
| **Face** | Enable, reindex, analytics, admin face search selfie |
| **Access grants** | Clients with access (via customer flow) |
| **Failed jobs** | Retry failed processing |

**Downloads on** = clients/QR may download **original** masters (not compressed previews).

---

## 5. Upload (`/dashboard/upload`)

| Control | Detail |
|---------|--------|
| Destination gallery | **Searchable** gallery picker (iPad keyboard) |
| Drop zone | Multi-file drag/drop or browse |
| Progress | % bar |
| Result | Uploaded count / errors |

Previews & thumbs generate in the worker after upload.

---

## 6. Messaging (`/dashboard/messaging`)

Tabs:

| Tab | What you do |
|-----|-------------|
| **Connection** | WhatsApp QR / link status, reconnect, daily send limit (~80) |
| **Templates** | Create/edit templates, triggers (guest QR, invoice, booking…), variables `{{name}}` etc. |
| **Send** | Phone, name, pick template, send one |
| **Bulk** | Select customers, template, send (capped/day) |
| **Activity** | Message logs |

---

## 7. Studio profile (`/dashboard/studio`)

Public CMS for customer app home/contact:

| Field group | Fields |
|-------------|--------|
| Brand | Display name, tagline, about, welcome message, logo, cover |
| Contact | Phone, WhatsApp, email, website |
| Social | Instagram, Facebook, YouTube |
| Location | Address, maps URL, working hours |
| Theme | Primary / secondary colors |
| Legal | Terms / privacy / refund HTML |

---

## 8. Packages (`/dashboard/service-packages`) — marketing packages

Shown on customer **Packages** tab.

| Field | Detail |
|--------|--------|
| Title, description | |
| Price, discount price | Shown as “₹X onwards” |
| Featured | Flag for home |
| Cover | Upload **or** pick Our Work image |
| Features | One per line |
| Booking steps | Custom timeline steps for this package |
| Active / order | Visibility |

Actions: New / Edit / Delete.

---

## 9. Portfolio (`/dashboard/portfolio`) — Our Work

| List shows | Actions |
|------------|---------|
| Cover, title, category, media count | **Add work**, Edit, Delete |
| | Add more media to a work |

**Add/Edit work**

| Field | Detail |
|--------|--------|
| Title, description, category | |
| Media | Multi upload (images/video) |
| Cover | First / primary |
| Display order, active | |

**Customer app:** grid = **cover thumb only**; multi-photo shows **+N** stack; full set on open.

CMS images use derived WebP thumbs/display (not multi‑MB masters).

---

## 10. Announcements (`/dashboard/announcements`)

| Field | Detail |
|--------|--------|
| Title, description | On customer home strip |
| Image | Optional |
| Priority, active, expires | |

---

## 11. Booking status (`/dashboard/bookings`)

Push job stage to a client’s app.

| Control | Detail |
|---------|--------|
| Customer | Searchable |
| Package | Searchable (drives step list) |
| Mode | Package/preset stage **or** custom status |
| Stage | Select from package steps or free text |
| Note | Optional message for client |

List of current bookings + history chips.

---

## 12. Billing (`/dashboard/invoices`)

### Summary strip

Outstanding · Collected · Billed · Clients with dues  

### Per-invoice card

| Info | Actions |
|------|---------|
| Invoice #, status, title | **Edit** |
| Customer, package | **Finalize & send** (draft) |
| Total, travel, paid, balance | **Record payment** / Round off |
| Installment plan (FIFO progress) | PDF view/download |
| Payment history (method, ref, note, date) | Undo/void payment |
| Terms / notes | Remove/void invoice |

### New / Edit invoice

| Field | Detail |
|--------|--------|
| Customer | Searchable (create only) |
| Package | Searchable |
| Title | |
| Service total ₹ | Draft editable |
| Travelling ₹ | Draft editable |
| Installments 0–N | Label, amount, due, terms (optional plan) |
| Invoice terms / notes | Always editable on edit |

**Payment modal (≈15s):** Amount · Payment / Round off / Write off · Method (UPI/Cash/…) · UTR/reference · Note · Allow overpay  

**Ledger rules:** outstanding = total − payments; installments are milestones only.  
See also: [INVOICE-PAYMENT-ARCHITECTURE.md](./INVOICE-PAYMENT-ARCHITECTURE.md).

---

## 13. Coupons (`/dashboard/coupons`)

| Field | Detail |
|--------|--------|
| Code, description | |
| Type | % or fixed |
| Value, min order, max redemptions | |
| Package scope | Optional package IDs |
| Active, start/end | |

---

## 14. Enquiries (`/dashboard/leads`)

Leads from customer app (Enquire / Book).

| Shown | Actions |
|--------|---------|
| Name, phone, package, source, message, status | Filter by status |
| | Update status (NEW → CONTACTED → WON/LOST) |

---

## 15. Selections (`/dashboard/selections`)

Client favorite/selection sessions.

| List | Detail page |
|------|-------------|
| Client, gallery, status, counts | Photo list, unlock, export CSV |

---

## 16. Pricing tiers (`/dashboard/pricing-packages`)

**ClientType** packages (access/workflow), not marketing packages:

| Field | Detail |
|--------|--------|
| Name, description | |
| Workflow | SELECT_ONLY / DOWNLOAD_ONLY / etc. |
| Included photos, pricing rules | |
| Active | |

*(Related older route: `/dashboard/packages`.)*

---

## 17. Jobs (`/dashboard/jobs`)

Failed background jobs (derivatives, face, etc.).

| Info | Actions |
|------|---------|
| Job type, error, gallery/photo | **Replay** |

---

## 18. Team (`/dashboard/team`)

| Field | Detail |
|--------|--------|
| Name, email, role | OWNER / MANAGER / STAFF |
| | Add member |

---

## 19. Settings (`/dashboard/settings`)

Workspace-level settings (studio config surface).

---

## Cross-cutting UX patterns

| Pattern | Where |
|---------|--------|
| **Cards + modals** | Most create/edit flows |
| **SearchableSelect** | Billing, upload gallery, bookings (iPad keyboard) |
| **Native select** | Short enums (method, role, status) |
| **Toasts** | Success/error |
| **PDF** | Invoices, agreements (view/download/base64 fallback) |
| **Roles** | STAFF: record payments; MANAGER+: void/refund/revise agreements money edges |
| **Global upload HUD** | Multi-file upload progress across pages |
| **Inputs 16px** | Reliable iPad/iOS keyboard focus |

---

## How this maps to the customer app

| Admin area | Customer sees |
|------------|----------------|
| Studio profile | Home hero, contact, branding |
| Portfolio | Our work |
| Service packages | Packages tab |
| Announcements | Home strip |
| Booking status | Home booking chip + Booking screen |
| Galleries + grants | Gallery tab (only if assigned) |
| Face search on gallery | Face tab |
| Invoices + payments | Invoices / Payments (paid & remaining) |
| Agreements | Contracts / agreements |
| Coupons | Apply on packages / invoices |
| Leads | From Enquire / Book buttons |
| Selections | Favorites / selection review |

---

## Typical studio day flow

1. **Customers** → add client (phone)  
2. **Galleries** → create → **Upload** photos → publish + downloads  
3. **Client detail** → grant gallery · optional agreement · optional invoice  
4. **Billing** → create invoice · record UPI/cash partials  
5. **Portfolio / Packages / Studio** → keep marketing fresh  
6. **Messaging** → WhatsApp templates & status  
7. **Bookings** → push “Editing / Album / Delivery” to the app  

---

## Related docs

- [INVOICE-PAYMENT-ARCHITECTURE.md](./INVOICE-PAYMENT-ARCHITECTURE.md) — billing ledger redesign  
- Stack: `admin-dashboard/` (Next.js), `backend/` (Express + Prisma), `customer-app/` (Flutter)  

---

*Last updated from live admin routes and UI code in `admin-dashboard/src`.*
