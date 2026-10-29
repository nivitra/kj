# Customer Portal V2

## Customer app (https://app.warmkelvin.com)

After sign-in you land on the **shell** with bottom navigation:

| Tab | Content |
|-----|---------|
| Home | Studio cover, welcome, announcements, galleries, featured package, quick actions |
| Gallery | Existing private galleries (unchanged face search / selection / download) |
| Face | Existing face search |
| Packages | Marketing packages — Book now / Enquire → leads |
| Profile | Customer profile |

**Drawer (menu):** Our work · Booking status · Contact studio · Privacy · Settings · Logout

## Admin CMS (https://admin.warmkelvin.com)

| Menu | Purpose |
|------|---------|
| Studio profile | Logo, cover, about, contact, socials, hours |
| Packages | Service packages with features, price, discount, cover |
| Portfolio | Our Work images/videos |
| Announcements | Home feed cards |
| Booking status | Per-customer production timeline |
| Enquiries | Leads from Book / Enquire / Contact |
| Pricing tiers | Existing ClientType selection pricing (renamed) |

CMS changes appear in the app on refresh — no redeploy.

## APIs

Customer (Bearer): `GET /api/portal/home|packages|portfolio|announcements|booking-status|contact|profile`, `POST /api/portal/lead`, `PATCH /api/portal/profile`

Admin (Bearer admin): `/api/admin/portal/*`

## Note on Cognito

Email Sign in / Create account work today via password auth. Full Cognito Hosted UI activates when `COGNITO_ENABLED=true` and the User Pool is configured (see COGNITO.md).
