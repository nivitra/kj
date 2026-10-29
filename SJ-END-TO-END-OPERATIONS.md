# SJ Studio — end-to-end operations

What the SJ / Warmkelvin app actually does, from the first public form through delivery, and how the pieces connect. Written from the current `studio-platform` code (API, admin dashboard, Flutter customer app), not from older plans.

Money has its own document: [INVOICING-END-TO-END.md](./INVOICING-END-TO-END.md). This file names every other operation and shows where it joins the invoice.

Production:

| Surface | Who | Tech | Host |
| --- | --- | --- | --- |
| Admin dashboard | Studio team | Next.js | `https://admin.warmkelvin.com` |
| Customer app | Clients, and some public pages | Flutter web and Android (`SJStudio-release.apk`) | `https://app.warmkelvin.com` |
| API | All of the above | Node, Express, Prisma, PostgreSQL | `https://api.warmkelvin.com` |
| Worker | Nobody directly | BullMQ on Redis | same deployment, `backend/src/worker.js` |

Photos sit in private S3 and are served with signed URLs (CloudFront when configured). Faces use Amazon Rekognition. Messages and login codes go out on WhatsApp (Baileys), not email.

The schema is multi-tenant (`Studio` on almost every row). Production is one studio: SJ Clicks and Films / Warmkelvin. An admin JWT only sees that admin’s `studioId`. A customer session only sees that customer’s `studioId`.

---

## 1. The whole business in one picture

```
Visitor / client                         Studio (admin)
────────────────                         ───────────────
Quotation request  ──────────────────►   Lead
Wedding / event inquiry ─────────────►   Inquiry triage
                                         Quote (price it, PDF, WhatsApp)
Accept a package   ◄─────────────────►   Convert
                                         │
                                         ├─ Invoice (50/50)          ── see invoicing doc
                                         ├─ Wedding agreement draft
                                         └─ Booking job (awaiting advance)
                                         Gallery + upload
                                         Sharp worker → thumb / preview
                                         optional Rekognition index
Access granted     ◄──────────────────   Publish + grant
Hearts + submit    ──────────────────►   Selection
                                         Start editing (locks those photos)
                                         Classify / bill extras ──► invoice add-on
Raw-dump purchase  ──────────────────►   Invoice; PAID unlocks originals
UPI “I paid”       ──────────────────►   Confirm claim → ledger + receipt
View galleries, quotes, agreements, invoices, portfolio
Guest QR           ──────────────────►   Limited gallery, face search, optional full access
```

Nothing in that chain is one database transaction from request to delivery. Each box is its own operation. The links are ids: `Lead` → `Quote` → `invoiceId` + `agreementId` + a job inside `CustomerBooking.jobs`, then `AccessGrant` → `Selection.overageInvoiceId`, and `EventGallery.bulkRawInvoiceId`.

---

## 2. Who can do what

| Actor | How they sign in | What they are |
| --- | --- | --- |
| Owner | Email + password, `POST /api/auth/admin/login` | Full admin. Only role that can create team members. |
| Manager | Same | Operations, including billing writes, quote convert, agreement PDF upload, raw-access grants, voiding payments. |
| Staff | Same | Upload and day-to-day gallery work. Billing routes reject non-GET from staff. |
| Customer | WhatsApp OTP, or phone + password, or Cognito hosted UI | One `Customer` row. Sees only their grants, quotes, invoices, agreements. |
| Public visitor | No account | Quotation request form. Gets a receipt token, not a login. |
| Gallery guest | Open a share link, then register | `GalleryGuest` session. Can see that gallery (and face-search it). Not a full client unless the studio upgrades them. |

Admin auth is a local JWT (bcrypt against `AdminUser.passwordHash`, HS256, about one day). It is not Cognito.

Customer auth, in `backend/src/routes/auth.js`:

1. **WhatsApp OTP** — `POST /api/auth/customer/otp-request` stores a code in Redis and sends it with `whatsapp.sendText`. `POST /api/auth/customer/otp-login` returns a customer JWT. Signup uses `signup-otp` and `signup-otp-verify` on the same channel. Password reset uses the same WhatsApp path (`forgot-password`, `reset-password`).
2. **Phone + password** — `POST /api/auth/customer/login`.
3. **Cognito** — `GET /api/auth/cognito/config`, app route `/auth/callback`, then `POST /api/auth/customer/session`. The API checks the Cognito access token and creates the `Customer` if needed (`cognitoSub`, `custom:studio_id`). Documented in `studio-platform/docs/COGNITO.md`.

`authenticateCustomer` prefers Cognito. The older studio JWT is the fallback when Cognito is off or `COGNITO_ALLOW_LEGACY_FALLBACK` is set. `backend/src/services/otp.js` (email via SMTP, SMS via Twilio) is not imported by the running auth routes. The root README still describes that older login; the live code sends codes on WhatsApp.

First boot, if no studio exists: `POST /api/auth/admin/setup` creates the studio and the owner.

Guest tokens:

| Token | Stored on | Used for |
| --- | --- | --- |
| `GalleryShareLink.token` | One link per shared gallery | `GET /api/share/public/:token`, app `/share/:token` and `/s/:token` |
| `GalleryGuest.sessionToken` | After the guest registers on that link | `Authorization` on `/api/share/guest/…` |
| Face guest JWT | Short-lived, `guest: true` | `/api/face` only |
| Quotation receipt JWT | `purpose: quotation-receipt` | Header `X-Quotation-Token` on the public request |

Short links (`ShortLink`, `GET /l/:token` and `GET /api/links/:token`) are a fourth kind. They redirect to an app path. They never widen access. Revoke with `DELETE /api/admin/links/:id` (owner or manager). Allowed pages include packages, quotes, contracts, invoices, billing, galleries, a single photo, portfolio, announcements, inquiries, and the quotation request. Invoice and billing links only resolve while that invoice is not draft and not void.

---

## 3. Ask for a price (quotation request → quote → booking)

This is the front door for new work.

### 3.1 Public request

App route `/quotation-request?studioId=…` (no login).

1. `GET /api/quotation-requests/:studioId/catalog` loads event types and services from the studio inquiry catalog.
2. `POST /api/quotation-requests/:studioId` (rate-limited) creates a `Lead` with source `QUOTATION_REQUEST`. It does **not** create an invoice, a booking, or a customer account that claims an existing login. A placeholder client may be created later, when the studio writes the quote.
3. The response carries a receipt token. The visitor tracks the request with `GET /api/quotation-requests/:studioId/:requestId` and header `X-Quotation-Token`. Sharing that receipt uses a short link `/r/<token>`.

A signed-in client can do the same from inside the app: `POST /api/portal/quotation-requests`. That lead stores `customerId`.

### 3.2 Studio writes the quotation

Admin `/dashboard/quotes` and `/dashboard/quotes/[id]`. Catalog of packages and add-ons is `/dashboard/templates` and `/dashboard/templates/addons` (`QuoteOption`, `QuoteAddOn`).

| Step | API | Result |
| --- | --- | --- |
| Price preview | `POST /api/admin/quotes/preview` | `computeQuote` in `services/billing/quotePricing.js`. Uses studio `taxPercent`. |
| Create | `POST /api/admin/quotes` from a lead | `Quote` draft. Lead moves to in review. |
| Edit | `PUT /api/admin/quotes/:id` | Updates `pricingSnapshot`. Editing clears a previously generated PDF so the file cannot go stale. |
| Generate PDF | `POST /api/admin/quotes/:id/finalize` | `buildQuotationPdf`, store on S3, status `SENT`. Can WhatsApp the PDF. |
| Or upload a PDF | `POST /api/admin/quotes/:id/pdf` | Same idea with the studio’s own file. |
| Client or admin accepts one option | `POST /api/portal/quotes/:id/accept` or `POST /api/admin/quotes/:id/accept` | `acceptQuote`. Status `APPROVED`. The chosen option is frozen on the snapshot. A second accept of a different option is rejected. |
| Convert | `POST /api/admin/quotes/:id/convert` | Owner or manager. See below. |

Accept does not take money. Convert does not take money either. Convert **creates** the bill.

### 3.3 Convert connects three records

`convertQuote` (`services/billing/quoteLifecycle.js`), one transaction:

- A **sent invoice** for the accepted total, with two reminders: Advance 50% and Event day 50%. Tax is its own line. Details: [INVOICING-END-TO-END.md](./INVOICING-END-TO-END.md) section 4.2.
- A **wedding agreement** in `DRAFT`, holding the same total and the invoice id in `formData`.
- A **job** on `CustomerBooking.jobs` with status `AWAITING_ADVANCE`, plus `invoiceId` and `agreementId`.
- The lead, if it is not already booked, becomes approved / won.
- The quote becomes `CONVERTED`. Doing it twice returns the same invoice.

After this, three screens show the same job from different sides: Invoices, the client’s agreement page, and Jobs (`/dashboard/bookings`). Paying the invoice does not by itself move the job forward. The studio updates the job.

---

## 4. Other ways a lead arrives

| Source | Who starts it | API | Lands in |
| --- | --- | --- | --- |
| Quotation request | Visitor or client | section 3 | Inquiries, then Quotes |
| Wedding inquiry | Client | `POST /api/portal/wedding-inquiry` | `Lead` with `inquiryKind: WEDDING`. Admin `/dashboard/inquiries`. |
| Event inquiry | Client | `POST /api/portal/event-inquiry` | Same lead list, non-wedding kind. Catalog from `inquiryCatalog`. |
| Enquire / book / contact / WhatsApp | Client | `POST /api/portal/lead` | `Lead.source` is `ENQUIRE`, `BOOK`, `CONTACT`, or `WHATSAPP`. Admin `/dashboard/leads`. WhatsApp `LEAD_RECEIVED` to the studio side. |
| Gallery guest registers | Guest | share register | `Lead` source `GALLERY_SHARE` |

Admin triage: `GET/PATCH /api/admin/portal/wedding-inquiries` (alias `/inquiries`), notes, and `PATCH /api/admin/portal/leads/:id`. Status values on the lead include `NEW`, `CONTACTED`, `WON`, `LOST` and inquiry status `PENDING`, `IN_REVIEW`, `APPROVED`, `REJECTED`, `BOOKED`. Slot fields (`requestedDate`, `slotStatus`, `confirmedDate`) are updated here or on the booking.

Inquiry form fields (event types, services, budgets) are studio content: `GET/PUT /api/admin/portal/inquiry-settings`, edited from the templates area.

---

## 5. Jobs and the calendar

One `CustomerBooking` per customer. Multi-job history is the JSON `jobs` array (`services/bookingJobs.js`), not a separate table. A job from a quotation carries the quote id, invoice id, agreement id, venue, dates, and a status history.

Default ladder (a package can replace the labels): enquiry received, through shooting, editing, and delivered.

| Action | Who | API |
| --- | --- | --- |
| List jobs | Admin | `GET /api/admin/portal/bookings` |
| Update the job | Admin | `PUT /api/admin/portal/bookings/:customerId` |
| Accept or set a slot | Admin | `PUT /api/admin/portal/bookings/:customerId/timeslot` |
| See the plan | Client | `GET /api/portal/booking-status`, and wedding plan `GET /api/portal/wedding-plan` |
| Ask to move the date | Client | `POST /api/portal/reschedule` |

Slot changes and booking updates fire WhatsApp (`BOOKING_UPDATE`, `SLOT_*`, `notifyShootSchedule`). The client app route is `/booking`.

---

## 6. Agreement and contract

Two tables:

- `WeddingAgreement` — the structured wedding form (names, date, venue, fee, payment-terms text, link to the quote and the invoice).
- `Contract` — the PDF the client actually opens and accepts. Status moves through sent / viewed / accepted.

| Step | Who | API |
| --- | --- | --- |
| Open or create the draft | Admin, client page `/dashboard/clients/[id]/agreement` | `GET/POST /api/admin/agreements/customer/:customerId/wedding` |
| Edit | Admin | `PUT /api/admin/agreements/:id` |
| Generate the PDF | Admin | `POST /api/admin/agreements/:id/finalize` builds it (`weddingAgreementPdf`), stores it, and creates a `Contract`. |
| Upload a PDF instead | Owner or manager | `POST /api/admin/agreements/:id/pdf`. Older acceptances are kept as history. Optional WhatsApp via `agreementNotify`. |
| Read and accept | Client, app `/contracts` | `GET /api/agreements/my` and `…/pdf`, plus the older `GET/POST /api/contracts/my/:id/accept`. |

Accepting the contract records acceptance. It does not write a payment and it does not change the invoice balance. Payment terms on the agreement are the same kind of text stored on `Invoice.terms`.

A plain uploaded contract, with no wedding form, still exists: `POST /api/admin/contracts`.

---

## 7. Packages, pricing, and coupons (the catalog)

Three different “packages” show up in the product. They are not the same row.

| Name in the UI | Table | What it controls |
| --- | --- | --- |
| Packages & pricing | `ServicePackage` (+ features) | What you sell: title, price, cover, marketing, booking-step labels. Admin `/dashboard/service-packages`. |
| Selection tier | `ClientType` | Included photo count and price per extra. Kept in sync from the service package by `packageSync`. The old screens `/dashboard/packages` and `/dashboard/pricing-packages` redirect to service packages. |
| Quote option | `QuoteOption` / `QuoteAddOn` | Lines the quotation builder can add. Not an invoice until convert. |

Studio-wide defaults live on `PricingSettings` (`GET/PUT /api/admin/pricing`): default included photos, extra rate, watermark, face-match threshold.

Coupons (`Coupon`) are a discount code, not a package. Admin `/dashboard/coupons`. They only change money once they are on an invoice. See the invoicing doc, section 8.

The client browses packages at `/packages` (`GET /api/portal/packages`). Asking for a package (`POST /api/customers/me/package-request`) sets `Customer.requestedPackageId`. That does not create an invoice. The billing screen says the studio still has to confirm and send one.

---

## 8. Gallery: create, upload, process, publish, grant

Admin `/dashboard/galleries` and `/dashboard/galleries/[id]`. Upload HUD: `/dashboard/upload`.

| Step | What happens | Records and side effects |
| --- | --- | --- |
| Create | `POST /api/galleries` | `EventGallery`, usually `DRAFT`. |
| Cover | `POST /api/galleries/:id/cover` | Cropped image on S3. |
| Register upload | `POST /api/upload/gallery/:id/register` | `Photo` row, presigned PUT to S3. |
| Finish upload | `POST /api/upload/…/complete` | Status uploaded, job queued. |
| Derivatives | Worker queue `derivatives` | Sharp writes a thumbnail and a preview (WebP). Optional watermark from pricing settings. Original kept. |
| Face index | If face search is on for the gallery | Queue `face-index` after derivatives. |
| Retry | `POST /api/upload/gallery/:id/retry-failed` | Re-queue failed photos. |
| Grant | `POST /api/galleries/:id/access` or from the client page | `AccessGrant`: expiry, download on/off, selection on/off, limits, face search. WhatsApp `GALLERY_ASSIGNED` when the client has a phone. |
| Publish | `PATCH /api/galleries/:id` status `PUBLISHED` | Client lists only published, unexpired, non-deleted galleries. WhatsApp `GALLERY_PUBLISHED`. |
| Client opens it | `GET /api/galleries/my/galleries` and `…/my/:id/photos` | Signed URLs. App `/gallery/:id` and `/gallery/:id/photo`. |
| Download one photo | `GET …/download-url` | Only if the grant and gallery allow downloads. |
| Soft-delete | `DELETE /api/galleries/:id` | `deletedAt`, purge scheduled about 30 days out. Hidden, not destroyed. |
| Restore | `POST /api/galleries/:id/restore` | Clears the trash markers. |
| Purge | `DELETE /api/galleries/:id/purge` | Deletes faces in Rekognition and the S3 prefix. |
| Raw access by hand | `POST/DELETE /api/galleries/:id/raw-access` | Owner or manager. Sets `AccessGrant.rawAccess` with no invoice. |

Entitlements (selection vs view, download, face, limits) are resolved in `services/galleryAccess.js` from the gallery plus the grant. The grant wins where it overrides.

Trash and the processing status are visible on the gallery admin page. Failed background work is also listed at `/dashboard/jobs` (`ProcessingJob`, `POST /api/admin/jobs/:id/replay`).

---

## 9. Selection and editing

Client: hearts on a photo, then the selection review screen. Admin: `/dashboard/selections` and `/dashboard/selections/[id]`.

| Step | Who | What it writes |
| --- | --- | --- |
| Heart or un-heart | Client `POST /api/photos/:id/favorite` | `Favorite`. If editing has started on that photo, it cannot be removed. This is also how the selection draft is built (`selectionWorkflow.setSelected`). |
| Open the selection | `GET /api/selections/my/:galleryId` | Included count, extra count, rate, which photos are locked. |
| Submit | `POST /api/selections/my/:galleryId/submit` | `Selection` + `SelectionItem`. Extras become an invoice (invoicing doc, section 4.3). Same submission twice does nothing. |
| Start editing | Admin, owner or manager, `POST /api/admin/selections/:id/start-editing` | Sets `editingStartedAt` on the current items. Client can still add more photos; those are a later batch. Refuses to start if the client has unsubmitted changes. |
| Reopen | Same route with a reason | Unlocks that batch. Requires a reason. |
| Classify | `POST /api/admin/selections/:id/classify` | Marks delivery type per item. |
| Bill | `POST /api/admin/selections/:id/bill` | Writes add-on lines onto the client’s open invoice (`billClassifiedSelection`). |
| Export | `GET /api/admin/selections/:id/export` | CSV for the editing desk. |

Favorites list for the client: `GET /api/photos/my/favorites`, app `/favorites`.

Included photos stay free. Only confirmed extras are billed. Photos already in editing keep the invoice from the batch that locked them.

---

## 10. Face search

Turned on per gallery. Pipeline:

1. Derivatives finish → `face-index` → Rekognition `IndexFaces` → `PhotoFace`.
2. Admin can reindex: `POST /api/admin/galleries/:id/reindex`. Toggle: `PATCH /api/admin/galleries/:id/face-search`.
3. Client (or guest) records consent: `POST /api/face/consent` → `ConsentRecord`.
4. Selfie: `POST /api/face/search/upload-url`, upload to a temp S3 key, `POST /api/face/search/submit` → queue `face-search`.
5. Worker runs `SearchFacesByImage`. Matches land in `FaceSearchMatch`. The app polls `GET /api/face/search/:sessionId/results`. Match scores are not shown to the client.
6. Broader search and “delete my selfie” are separate routes. Deleting a photo enqueues `face-delete`. Temp selfies are removed by the `cleanup` queue.

Threshold order: environment, then `PricingSettings`, then the gallery (`services/threshold.js`). The adapter is `services/rekognition.js` (a mock exists for tests). Operational notes: `studio-platform/docs/rekognition.md` and `docs/runbook.md`.

App route: `/find-me`. Guests can open it with a guest token in the query string.

---

## 11. Guest share

Studio or client creates a `GalleryShareLink`. The public URL is `/share/<token>` (older) or `/s/<token>`.

1. `GET /api/share/public/:token` shows the gallery gate.
2. Guest registers (`POST` on that flow) → `GalleryGuest` session, a shadow customer when needed, lead source `GALLERY_SHARE`, WhatsApp `GUEST_REGISTERED`.
3. Guest can list photos and download only what the link allows.
4. Guest can start a face session (`POST /api/share/guest/face-session`).
5. Full access, if the studio set a code: `POST /api/share/guest/full-access` unlocks the rest of that gallery and can WhatsApp `GUEST_FULL_ACCESS`.

A guest session is not a customer login. It cannot open invoices, agreements, or other galleries.

---

## 12. Studio website inside the app

The client app is also the studio’s public site, backed by `StudioProfile` and the portal routes.

| Content | Admin | Client |
| --- | --- | --- |
| Name, logo, cover, about, phone, WhatsApp, address, hours, colours, theme, terms / privacy / refund HTML, UPI id, payment QR | `/dashboard/studio`, `PUT /api/admin/portal/profile` | `GET /api/portal/studio`, home, contact |
| Packages | service packages | `/packages` |
| Portfolio (photos, video, reels) | `/dashboard/portfolio` | `/portfolio` |
| Announcements (feed, banner, popup) | `/dashboard/announcements` | home and `/announcements` |
| Wedding home | Flag `Customer.weddingExperience` plus couple names, date, venue, hero photos | `WeddingHomeScreen` instead of the normal home |

`GET /api/portal/home` bundles the home screen. UPI id and the payment QR on the profile are what the invoice pay sheet uses. They are not a payment gateway.

Client profile edits (name and wedding fields the product allows) go through `PATCH /api/portal/profile`. App route `/profile-edit`.

---

## 13. WhatsApp

One Baileys session per studio (`WhatsAppSession`), restored when the API boots. Admin `/dashboard/messaging`.

| API group | Use |
| --- | --- |
| `/api/admin/whatsapp/status`, `connect`, `disconnect`, `settings` | QR pairing and switches |
| `/templates` | Create, edit, preview, delete |
| send and `/campaigns` | One-off and bulk |
| `/messages`, `/recipients` | Log and who can be reached |

Automatic templates (`triggerAuto`) already wired from the product:

| Key | When |
| --- | --- |
| `GUEST_REGISTERED`, `GUEST_FULL_ACCESS` | Share link |
| `LEAD_RECEIVED` and lead updates | New enquiry |
| `BOOKING_UPDATE`, slot keys | Jobs |
| `GALLERY_PUBLISHED`, `GALLERY_ASSIGNED` | Gallery |
| `INVOICE_INSTALLMENT_PAID`, `PAYMENT_RECORDED` | A payment was recorded |
| `INVOICE_SENT` | Only if something calls `notifyInvoiceWhatsApp`, which nothing does today |
| `CLIENT_PHONE_ADDED` | A phone number is saved on a client |

Direct sends, not templates: login and signup OTP (`sendText`), quotation PDF (`sendDocument`), agreement notify.

Guards: a daily touchpoint cap, a typing delay, about six hours of dedupe on the same automatic message, and `DISABLE_OUTBOUND_NOTIFICATIONS=true` to stop everything outbound.

There is no live email or Twilio path. Announcements are the in-app channel.

---

## 14. Invoicing (pointer)

Four births, one ledger:

1. Admin creates a draft and finalizes it.
2. Quote convert creates a sent invoice, a draft agreement, and a booking job together.
3. Selection submit (and, later, admin “bill”) adds extra-photo lines.
4. Raw-dump request creates an “all originals” invoice. When it is paid, raw download turns on for that gallery. If it stops being paid, that automatic unlock turns off.

The client never posts cash. They open UPI or the QR, then submit a reference. A manager confirms it on `/dashboard/payments`. Until then the balance does not move.

Full routes, status rules, coupons, receipts, FIFO milestones, and the code map: [INVOICING-END-TO-END.md](./INVOICING-END-TO-END.md).

---

## 15. Frame shop (still in the API, not in the product UI)

`FrameProduct`, `Order`, `OrderItem`, and `Payment` still have routes:

- Admin: `/api/admin/frames`, `/api/admin/orders`, `/api/admin/payments`
- Client: `GET /api/frames`, `POST /api/orders`, `GET /api/orders/my`

No admin page and no Flutter screen calls them. Do not confuse `Payment` with `InvoicePayment`. Studio bills are invoices.

---

## 16. Background work

`node src/worker.js` consumes Redis queues defined in `backend/src/queues/index.js`.

| Queue | Does |
| --- | --- |
| `derivatives` | Thumbnails and previews. Then face index if the gallery wants it. |
| `face-index` | Index faces for one photo. |
| `face-search` | Search by selfie. |
| `face-delete` | Remove faces when a photo is deleted. |
| `cleanup` | Delete temp selfies and similar. |

Each job is also a `ProcessingJob` row (attempts, dead letter). Admin replay is `/dashboard/jobs`. On boot the worker runs `recoverStuck()`.

Invoice PDFs, quotation PDFs, and agreement PDFs are generated in the API request, not in this worker.

---

## 17. Admin screens

From `admin-dashboard/src/components/Sidebar.tsx`.

| Path | Operation |
| --- | --- |
| `/dashboard` | Counts and recent activity. |
| `/dashboard/clients`, `/clients/[id]` | Clients, package, grants, wedding flag, payment rollup. |
| `/dashboard/clients/[id]/agreement` | Wedding agreement. |
| `/dashboard/bookings` | Jobs and slots. |
| `/dashboard/inquiries` | Wedding and event inquiries. |
| `/dashboard/leads` | Other leads. |
| `/dashboard/quotes`, `/quotes/[id]` | Quotations, PDF, accept, convert. |
| `/dashboard/invoices` | Create, finalize, record payments, PDF, share. |
| `/dashboard/payments` | Confirm or reject UPI claims. |
| `/dashboard/galleries`, `/galleries/[id]` | Galleries, grants, face, trash. |
| `/dashboard/upload` | Bulk upload. |
| `/dashboard/selections`, `/selections/[id]` | Editing, classify, bill. |
| `/dashboard/messaging` | WhatsApp. |
| `/dashboard/service-packages` | What you sell. |
| `/dashboard/templates`, `/templates/addons` | Quote catalog. |
| `/dashboard/coupons` | Discount codes. |
| `/dashboard/portfolio`, `/announcements`, `/studio` | The client-facing site. |
| `/dashboard/team` | Admins. Owner creates members. |
| `/dashboard/settings` | Workspace. |
| `/dashboard/jobs` | Failed processing jobs. |

---

## 18. Client app routes

From `customer-app/lib/router/app_router.dart`.

| Path | Who | Operation |
| --- | --- | --- |
| `/login` | Public | OTP, password, signup. |
| `/auth/callback` | Public | Cognito return. |
| `/quotation-request` | Public if `studioId` is present, else client | Ask for a quote. |
| `/l/:token`, `/r/:token` | Public | Short link and quotation receipt. |
| `/link-unavailable` | Public | Revoked or dead link. |
| `/share/:token`, `/s/:token` | Public | Guest gallery. |
| `/app` | Client | Home shell. Wedding home when flagged. |
| `/gallery/:id`, `/gallery/:id/photo`, `/gallery/:id/selection` | Client | Browse, view, choose photos. |
| `/favorites`, `/find-me` | Client (find-me also for guests) | Hearts, face search. |
| `/quotes` | Client | Read and accept. |
| `/contracts` | Client | Read and accept the PDF. |
| `/invoices`, `/billing` | Client | Bills, UPI, claims, coupons. |
| `/packages`, `/portfolio`, `/announcements` | Client | Catalog and site. |
| `/booking` | Client | Job status, reschedule. |
| `/wedding-inquiry`, `/event-inquiry` | Client | Structured enquiries. |
| `/contact`, `/profile-edit` | Client | Studio contacts, own profile. |

---

## 19. API mount points

From `backend/src/index.js`.

| Prefix | Router | Auth |
| --- | --- | --- |
| `/health`, `/health/live`, `/health/ready`, `/metrics` | process | Public (metrics as deployed) |
| `/l`, `/api/links` | `shortLinks.js` | Public resolve; create needs a session; revoke is admin |
| `/api/auth` | `auth.js` | Mixed |
| `/api/admin` | `admin.js`, `adminCommerce.js` | Admin |
| `/api/admin/portal` | `portal.js` admin router | Admin |
| `/api/admin/share` | `share.js` | Admin |
| `/api/admin/agreements` | `agreements.js` | Admin |
| `/api/admin/quotes` | `quotes.js` | Admin |
| `/api/admin/billing` | `billing.js` | Admin |
| `/api/admin/whatsapp` | `whatsapp.js` | Admin |
| `/api/galleries` | `gallery.js` | Admin or customer, by route |
| `/api/photos` | `photo.js` | Admin or customer |
| `/api/upload` | `upload.js` | Admin |
| `/api/face` | `face.js` | Customer or guest |
| `/api/selections` | `selection.js` | Customer |
| `/api/customers` | `customer.js` | Customer |
| `/api/portal` | portal, quotes, quotation requests | Customer |
| `/api/quotation-requests` | public router | Public + receipt token |
| `/api/share` | `share.js` | Public, guest, or customer |
| `/api/agreements` | customer router | Customer |
| `/api/billing` | `billing.js` | Customer |
| `/api` shop routes | `shop.js` | Customer (frames, orders, legacy contracts) |

---

## 20. Data the operations share

| Record | Written by | Read by |
| --- | --- | --- |
| `Studio`, `AdminUser` | Setup, team | Every admin request |
| `Customer` | Signup, admin create, quote placeholder, guest shadow, Cognito | Everything client-scoped. Payment rollup fields rewritten when invoices change. |
| `Lead` | Public form, inquiries, contact, guest register | Inquiries, leads, quote create |
| `Quote` | Quote editor | Client quotes, convert |
| `Invoice` and ledger | Billing, convert, selection, raw dump | Invoices, billing, short links, raw access |
| `WeddingAgreement`, `Contract` | Convert, agreement editor | Contracts screen |
| `CustomerBooking` | Convert, booking editor, selection notes | Jobs, client booking |
| `ServicePackage`, `ClientType` | Packages screen | Quotes, selection limits, coupons |
| `EventGallery`, `Photo`, `AccessGrant` | Galleries, upload, worker | Client galleries, face, selection, raw dump |
| `Favorite`, `Selection` | Hearts and submit | Editing desk, overage invoice |
| `StudioProfile`, portfolio, announcements | CMS screens | Portal home |
| `GalleryShareLink`, `GalleryGuest`, `ShortLink` | Share actions | Guest app, `/l` redirects |
| `WhatsAppSession`, templates, message log | Messaging screen and triggers | Outbound log |
| `ProcessingJob`, face tables | Worker | Jobs screen, find-me |

---

## 21. What is leftover

| Path | State |
| --- | --- |
| `services/otp.js` and the README’s email/SMS login | Not used. Login codes are WhatsApp. |
| `syncSelectionOverageInvoice` | Exported, no route calls it. Submit and “bill” are the live selection charges. |
| `notifyInvoiceWhatsApp` | Exported, no caller. Payment WhatsApp still sends. |
| `Invoice.kind = RECEIPT` | Old rows only. New receipts are the `Receipt` table. |
| `PUT` invoice body `markInstallmentPaid` | Bypasses the ledger service. The invoices screen does not use it. |
| Frame shop routes | API only. |
| `/dashboard/packages`, `/dashboard/pricing-packages` | Redirect to service packages. |
| `/share/:token` | Still works. Newer links use `/s/:token`. |

---

## 22. Where to change things

| If you are changing… | Start here |
| --- | --- |
| Login | `backend/src/routes/auth.js`, `services/cognito.js`, `services/whatsapp.js` |
| A public quote request | `routes/quotationRequests.js`, `services/quotationRequest.js` |
| Pricing a quote | `services/billing/quotePricing.js`, `routes/quotes.js` |
| Turning a quote into a job | `services/billing/quoteLifecycle.js` |
| An invoice or a payment | `routes/billing.js`, `services/billing/` — and the invoicing doc |
| An agreement PDF | `routes/agreements.js`, `services/weddingAgreementPdf.js` |
| A gallery or a grant | `routes/gallery.js`, `services/galleryAccess.js` |
| Upload and thumbnails | `routes/upload.js`, `queues/processors/derivatives.js`, `services/imageProcessor.js` |
| Photo choice and extra charges | `services/selectionWorkflow.js`, `services/selectionDelivery.js` |
| Face search | `routes/face.js`, `services/rekognition.js`, `queues/processors/` |
| Guest links | `routes/share.js`, `services/shortLinks.js` |
| The client home page | `routes/portal.js`, admin studio / portfolio / announcements |
| WhatsApp copy | `routes/whatsapp.js`, `services/whatsapp.js` |
