# Rekognition — Face pipeline

## Why Rekognition Image (not Custom Labels / Video)

We index faces from wedding/event photographs and match a customer selfie against that collection. Rekognition Image `IndexFaces` + `SearchFacesByImage` is the right primitive: managed vectors, per-face quality filters, and pay-per-call economics that stay cheap at studio scale.

## Collection strategy

- **One collection per environment**, e.g. `sj-studio-prod-faces-v1`.
- Not per-studio and not per-event. PostgreSQL is the source of truth for face ↔ photo ↔ gallery ↔ studio relationships.
- `ExternalImageId` = photo UUID (opaque, non-PII).
- Collection id is resolved through a single adapter (`src/services/rekognition.js`) so per-studio collections can be introduced later without route changes.

## Threshold calibration

Resolution order: **env `FACE_MATCH_THRESHOLD` → studio `PricingSettings.faceSearchThreshold` → gallery `faceSearchThreshold`**.

| Similarity | Behaviour |
|---|---|
| ≥ 98 | Shown (high tier, admin analytics only) |
| 95–97.99 | Shown (standard) |
| 90–94.99 | Only after explicit **broader search** opt-in |
| < 90 | Not returned |

Customers never see similarity scores. UI copy: *"Photos that may include you."*

## Limitations (set expectations with studios)

- **Largest / clearest face bias** on dense group shots — small distant faces may not index.
- **Lighting & pose** — side profiles, heavy blur, sunglasses reduce match quality.
- **Group selfies rejected** — search requires exactly one primary face in the selfie.
- **Not identity verification** — never market as “this is you for certain.”

## Deletion behaviour

Photo delete → `DeleteFaces` → S3 objects → DB rows (worker job, idempotent).  
Customer `POST /api/face/data/delete` wipes sessions/matches and withdraws consent.  
Selfies are deleted on every code path; S3 lifecycle expires `temporary-face-search/` in 1 day as backstop.

## Cost model (verify current `ap-south-1` pricing)

Rough Image API ballpark:

- Indexing ≈ $1 / 1,000 images  
- Search ≈ $1 / 1,000 calls  
- Face storage ≈ $0.01 / 1,000 faces·month  

A 3,000-photo wedding (~2 faces avg) ≈ **~$3 one-time + a few cents/month**.  
Guards: hash dedupe, index-once, no `CompareFaces` loops, search rate limits, no labels/OCR.

## Modes

| `REKOGNITION_MODE` | Use |
|---|---|
| `live` | Production / staging with AWS credentials |
| `mock` | Local dev + unit tests (deterministic in-memory) |

## Upgrade path (not v1)

Rekognition user vectors (`CreateUser` / `AssociateFaces` / `SearchUsersByImage`).  
Schema already has `PhotoFace.userProfileId?` for a drop-in later.
