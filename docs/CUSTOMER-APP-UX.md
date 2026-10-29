# Customer app UX map (signed-in portal only)

**Scope:** Flutter client portal for full clients after login.  
**Out of scope:** QR / `/share/…` guest flow (`guest.html` + `GuestShareScreen`).

**Stack:** Flutter (web + mobile), Riverpod, GoRouter.  
**Repo path:** `customer-app/`

> **2026-07-22 redesign (complete):** OTP-first auth, dark mode, curated Home, intelligent shell, visual booking timeline, glass payments, masonry portfolio + Hero detail, cinematic photo viewer (drag dismiss), selection success dialog, in-app PDF, UPI pay deep-link, expandable packages, gallery badges, face-scan animation, offline-friendly image cache.

---

## 1. What this app is

A **branded studio client portal**. After WhatsApp OTP (or phone + password) login, the client gets:

- Marketing content (Our work, Packages, Contact)
- Private work only when the studio grants galleries
- Job status, payments, agreements, selection, face search (when enabled)

Warm, studio-feel UI: canvas background, display type, soft cards, bottom nav + drawer.

---

## 2. Entry & auth

| Mode | What the user does |
|------|---------------------|
| **Sign up** (default) | Name + phone + password (min 8) + confirm |
| **Sign in** | Phone + password |
| **Forgot** | Phone → WhatsApp OTP |
| **Reset** | OTP + new password |

- India 10-digit numbers normalize to `91…`
- Session kept; unauthenticated private routes → `/login`
- Logged-in on `/login` → `/app`
- Cognito callback exists (`/auth/callback`) but day-to-day path is phone + password

### Routes (auth)

| Path | Screen |
|------|--------|
| `/login` | Sign up / sign in / forgot / reset |
| `/auth/callback` | OAuth/Cognito return (if used) |

---

## 3. App shell (after login)

**Route:** `/app`  
**Tabs via query:** `?tab=home|gallery|face|work|packages|profile`

### Bottom navigation (dynamic)

| Tab | Always? | When shown |
|-----|---------|------------|
| **Home** | Yes | Always |
| **Gallery** | No | Studio has granted ≥1 gallery |
| **Face** | No | Has galleries **and** face search on for an assigned gallery |
| **Our work** | Yes | Portfolio / marketing |
| **Packages** | Yes | Service packages |
| **Profile** | Yes | Account + studio summary |

While galleries are loading, **Gallery** and **Face** stay hidden (no flash of gated tabs).

### Side drawer (hamburger on Home)

- Home, Our work, Packages  
- My galleries / Find my photos (if gated open)  
- Booking status, Payments, Contact studio, Profile  
- Quick call / WhatsApp / Instagram  
- Log out  

**Implementation:** `lib/screens/shell_screen.dart`

---

## 4. Home

**Pull-to-refresh.** Cache-first paint, then silent revalidate.

1. **Studio hero** — logo, name, cover; tap → Contact  
2. **Hello, {first name}** + welcome / about  
3. **Status banner** — free text from admin (`customer.status`)  
4. **Booking chip** — current stage; tap → Booking  
5. **“No private gallery yet”** — if none assigned  
6. **Quick actions** (horizontal): Our work, Packages, Galleries*, Face*, Booking, Contact, Profile  
7. **Announcements** (horizontal cards)  
8. **Your galleries** (if any) — cover + name → gallery detail  
9. **Featured package** — Enquire → lead to studio  
10. **Our work strip** — covers → full portfolio  
11. **Studio tile** — phone/address teaser → Contact  

\* Galleries / Face only when access allows.

**Implementation:** `lib/screens/home_screen.dart` · API: `PortalApi.home()`

---

## 5. Our work (portfolio)

- Category chips: All + categories from CMS  
- List of portfolio items (cover thumbs — CMS derivatives for speed)  
- Tap item → **bottom sheet**: title, description, category, media  
- Multi-media loads after open when detail API returns  
- Not the client’s private gallery; public studio showcase  

**Implementation:** `lib/screens/portfolio_screen.dart`

---

## 6. Packages

- Coupon field (validate / apply before enquire)  
- Cards: cover, title, price / discount, features  
- Actions: **Book Now** / **Enquire** → creates lead (+ optional coupon)  
- Snackbar confirmation to the client  

**Implementation:** `lib/screens/packages_screen.dart`

---

## 7. Gallery (private, assigned only)

### List (`Galleries` tab)

- Assigned galleries only (never auto-open)  
- Cards: cover, name, counts / status  
- Favorites shortcut  
- Pull to refresh  

### Gallery detail

- Infinite grid of photos/videos  
- Filter: **All | Photos | Videos**  
- **Heart** = favorite / selection candidate (if selection allowed)  
- Tap → full **photo viewer** (swipe, heart, download if allowed)  
- Selection locked after submit until studio unlocks  
- **Downloads**: single + bulk only if studio enabled; **originals only** for download  
- Entry to **Review selection** when selection workflow applies  
- Workflow modes roughly: select-only, select+download, download-only  

### Selection review

- Shows hearted set  
- Optional note  
- Confirm dialog → **Submit** → locked until studio unlocks  

### Favorites

- Route `/favorites`  
- Cross-gallery favorites list  
- Reachable from gallery chrome  

### Face search (tab when enabled)

1. Consent  
2. Selfie (camera / library)  
3. Searching  
4. Results grid (**no similarity scores**)  
5. Empty / error states  

Signed-in clients use their session. Guest tokens are only for the separate QR path (out of scope here).

**Implementation:**  
`galleries_screen.dart`, `gallery_detail_screen.dart`, `photo_viewer_screen.dart`,  
`selection_review_screen.dart`, `favorites_screen.dart`, `face_search_screen.dart`

---

## 8. Profile

- Studio brand strip → Contact  
- Avatar initial, name, phone  
- **Edit**: name + phone  
- Status banner (same as Home if set)  
- **Account:** phone, joined, gallery count, favorites count, package  
- **Booking:** stage, package, notes → full timeline  
- **Payments:** total / paid / balance / terms (studio-entered)  
- Links: invoices, agreements, Our work, Packages  
- Log out  

**Implementation:** `lib/screens/profile_screen.dart`

---

## 9. Stacked screens (not bottom tabs)

| Screen | Path | Purpose |
|--------|------|---------|
| **Booking status** | `/booking` | Current stage, package steps/timeline, history, notes, ETA |
| **Payments / invoices** | `/invoices` | Summary + invoice list, detail, PDF, coupon on invoice |
| **Agreements** | `/contracts` | PDF contracts + wedding agreements; open external |
| **Contact** | `/contact` | Studio profile, phone, WhatsApp, email, socials, address, hours |
| **Photo viewer** | `/gallery/:id/photo` | Fullscreen swipe, heart, download |
| **Selection review** | `/gallery/:id/selection` | Finalize hearts → studio |
| **Favorites** | `/favorites` | Hearted photos across galleries |

---

## 10. Access & content rules

```
Login always → marketing shell (Home / Our work / Packages / Profile)

Studio grants gallery access
  → Gallery tab appears
  → Home shows “Your galleries”

Gallery has face search enabled
  → Face tab appears

Admin sets status text
  → Banner on Home + Profile

Admin pushes booking stage
  → Home chip + Booking timeline + Profile

Admin sets payment terms / invoices
  → Profile payments + Invoices screen

Admin uploads agreements
  → Profile + Contracts

Package / workflow on gallery
  → Hearts, submit, download buttons on/off
```

Private photos never appear without an access grant. Marketing content is always available after login.

---

## 11. End-to-end journeys

### A. New lead / curious visitor who signed up

Login → Home (no gallery) → Our work / Packages → Book or Enquire → Contact studio → wait for assignment.

### B. Booked client, pre-delivery

Status banner + booking timeline → package/payment on Profile → agreements PDFs → still no or limited galleries.

### C. Photos ready — select favorites

Gallery tab → open gallery → heart photos → Review selection → Submit → locked → studio edits.

### D. Delivery / downloads

Gallery with downloads on → view + download originals (single/bulk) → maybe download-only mode (no hearts).

### E. Face find-me (client app)

Face tab → consent → selfie → result photos in that gallery context.

### F. Billing

Profile or drawer → Payments → invoice list → detail / PDF / coupon.

---

## 12. Performance / product notes (current behavior)

- **Portal cache** on Home, portfolio, packages (fast second open)  
- **CMS thumbs** for Our work / package covers (not multi‑MB masters)  
- Gallery **preview** = compressed WebP; **download** = pure originals  
- Pull-to-refresh on major lists  
- IndexedStack shell keeps tab state  

---

## 13. Navigation map (customer portal only)

```
/login  (sign up | sign in | forgot | reset)
   │
   ▼
/app ── bottom nav ──────────────────────────────
   │         │            │         │        │
 Home    Gallery*      Face*    Our work  Packages  Profile
   │         │            │         │        │         │
   │    /gallery/:id      │    detail sheet  Enquire   edit
   │         │            │                  Book      │
   │    photo viewer      │                            ├─ /booking
   │    selection review  │                            ├─ /invoices
   │    /favorites        │                            ├─ /contracts
   │                      │                            └─ /contact
   └─ drawer: same destinations + log out

* only if studio assigned / enabled
```

### Key source files

| Area | File |
|------|------|
| Router | `lib/router/app_router.dart` |
| Shell / tabs | `lib/screens/shell_screen.dart` |
| Auth | `lib/screens/login_screen.dart`, `lib/providers/auth_provider.dart` |
| Portal APIs | `lib/services/portal_api.dart` |
| Gallery APIs | `lib/services/api_service.dart` |
| Theme | `lib/theme/app_theme.dart` |

---

## 14. What is *not* in this app

| Not here | Where it lives |
|----------|----------------|
| QR scan name/phone guest entry | `guest.html` + `/share/:token` |
| Guest full-access code unlock | Share guest flow |
| Admin tools | Admin dashboard (`admin-dashboard/`) |
| Creating galleries / grants | Studio staff only |

See also: `docs/ADMIN-DASHBOARD-UX.md` for the studio admin surface.

---

*Last updated: 2026-07-22 — reflects current `customer-app` shell, gated Gallery/Face tabs, portal CMS screens, selection, billing, and agreements.*
