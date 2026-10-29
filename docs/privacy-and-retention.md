# Privacy & retention — face search

## Consent

Before any selfie upload the customer must accept consent (`POST /api/face/consent`):

- Policy version recorded (`CONSENT_POLICY_VERSION`)
- IP + user-agent stored as **hashes only**
- Explicit confirmation in the client UI

Withdrawal: `POST /api/face/data/delete` sets `withdrawnAt` and deletes sessions/matches.

## Selfie retention (zero by design)

1. **Inline delete** after every search path (success, reject, fail)  
2. **Periodic worker sweep** (`SELFIE_SWEEP_INTERVAL_MS`, default 15 min) expires stale sessions  
3. **S3 lifecycle** on `temporary-face-search/` → expire after **1 day**

Selfies never enter the Rekognition collection. Only event photos are indexed.

## What is stored long-term

| Data | Retention |
|---|---|
| Photo derivatives (thumb/display) | Studio policy / gallery `retentionUntil` |
| `PhotoFace` vectors (Rekognition + DB) | Until photo/gallery deleted |
| Face search sessions/matches | Until customer data-delete or operational purge |
| Consent records | Kept for audit after withdrawal |

## Event / gallery expiry

When a gallery hits `retentionUntil` or is deleted, enqueue bulk face + object cleanup (admin/ops via reindex/delete flows and `npm run reconcile --fix` for stuck state).

## Studio operator responsibilities

- Enable face search **only** on galleries clients consented to use it on  
- Share login credentials securely (studio-issued ID + password)  
- Respond to deletion requests within local legal timelines  
- Never export raw face IDs or signed selfie URLs into support tickets  
- Keep `REKOGNITION_COLLECTION_ID` and AWS keys out of client apps  

## Logging redactions

Never log: image bytes, signed URLs, JWTs, raw Rekognition face IDs, customer contact info in plaintext.
