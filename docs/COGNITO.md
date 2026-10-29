# Amazon Cognito — Customer Authentication

Customer portal authentication uses **Amazon Cognito User Pools** with
**Authorization Code Flow + PKCE**. Admin dashboard login remains local JWT.

Passwords are **never** stored in PostgreSQL for Cognito users. The immutable
identity is Cognito `sub` → `Customer.cognitoSub`.

---

## Architecture

```
Flutter Web  --PKCE-->  Cognito Hosted UI  --code-->  Flutter /auth/callback
                              |
                         access_token
                              |
Flutter  --Authorization: Bearer access_token-->  Express API
                              |
                     JWKS verify (jose)
                              |
              find/create Customer by cognito_sub
```

Admin APIs that manage Cognito users (enable/disable/delete/reset) use the
**EC2 instance role** via the default AWS credential chain — no static keys.

---

## 1. Create the User Pool (AWS Console or CLI)

### Pool settings

| Setting | Value |
|---|---|
| Sign-in options | **Email** |
| Password policy | Studio default (min 8, upper/lower/number) |
| MFA | Optional |
| Self-registration | Enable if public sign-up is desired |
| Required attributes | `email`, optional `name`, `phone_number` |
| Custom attribute | `custom:studio_id` (String, mutable) — multi-tenant routing |
| App client | **Public client** (no secret) for Flutter PKCE |
| Auth flows | ALLOW_USER_SRP_AUTH, ALLOW_REFRESH_TOKEN_AUTH |
| Hosted UI domain | e.g. `sj-studio-prod` |
| Callback URL | `https://app.warmkelvin.com/auth/callback` |
| Sign-out URL | `https://app.warmkelvin.com/` |
| OAuth flows | **Authorization code grant** |
| Scopes | `openid` `email` `profile` |
| Identity providers | Cognito user pool |

### Example CLI sketch

```bash
aws cognito-idp create-user-pool \
  --pool-name sj-studio-customers \
  --auto-verified-attributes email \
  --username-attributes email \
  --schema Name=email,Required=true,Mutable=true \
           Name=name,Required=false,Mutable=true \
  --policies 'PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}' \
  --region ap-south-1

# Note PoolId, then create domain + app client with generate-secret=false
# and explicit auth flows + callback URLs.
```

### IAM (instance role)

Attach a policy allowing:

```json
{
  "Effect": "Allow",
  "Action": [
    "cognito-idp:AdminCreateUser",
    "cognito-idp:AdminDisableUser",
    "cognito-idp:AdminEnableUser",
    "cognito-idp:AdminDeleteUser",
    "cognito-idp:AdminResetUserPassword",
    "cognito-idp:AdminGetUser",
    "cognito-idp:AdminSetUserPassword",
    "cognito-idp:ListUsers"
  ],
  "Resource": "arn:aws:cognito-idp:ap-south-1:ACCOUNT:userpool/POOL_ID"
}
```

---

## 2. Environment variables

Add to `studio-platform/.env` (and docker-compose already forwards `env_file`):

```bash
COGNITO_ENABLED=true
COGNITO_USER_POOL_ID=ap-south-1_XXXXXXXXX
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_REGION=ap-south-1
# Hosted UI domain host only (no https://)
COGNITO_DOMAIN=sj-studio-prod.auth.ap-south-1.amazoncognito.com
COGNITO_REDIRECT_URI=https://app.warmkelvin.com/auth/callback
COGNITO_LOGOUT_URI=https://app.warmkelvin.com/
# Optional: force new self-registered users into this studio
COGNITO_DEFAULT_STUDIO_ID=
# Keep legacy loginId/password during migration (default off when Cognito enabled)
COGNITO_ALLOW_LEGACY_FALLBACK=false
```

Docker Compose passes these through `env_file: .env`. Rebuild/restart backend after changes:

```bash
cd studio-platform
docker compose --env-file .env up -d --build backend worker
```

---

## 3. Database

Prisma schema fields on `Customer`:

| Column | Purpose |
|---|---|
| `cognitoSub` | Unique Cognito `sub` |
| `email` / `emailVerified` | From token / admin |
| `accountStatus` | `ACTIVE` \| `DISABLED` |
| `storageUsedBytes` | Admin display |
| `passwordHash` / `loginId` | Nullable legacy |

Applied automatically via `prisma db push` on container start.

---

## 4. Backend API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/auth/cognito/config` | public | Client ID, domain, redirect, scopes |
| POST | `/api/auth/customer/session` | access token body | Provision customer row |
| GET | `/api/auth/customer/me` | Bearer | Profile |
| * | `/api/customers/*` | Bearer Cognito | Protected by `authenticateCustomer` |
| * | `/api/galleries/my/*` | Bearer Cognito | Tenant-isolated |
| POST | `/api/admin/customers/:id/disable` | admin JWT | Cognito disable |
| POST | `/api/admin/customers/:id/enable` | admin JWT | Cognito enable |
| DELETE | `/api/admin/customers/:id` | admin JWT | Delete Cognito + local |
| POST | `/api/admin/customers/:id/reset-password` | admin JWT | Cognito reset email |
| GET | `/api/admin/customers/:id/cognito` | admin JWT | Cognito user details |

JWT verification uses the pool JWKS:

`https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`

---

## 5. Flutter Web

1. User taps **Sign in with email** → Hosted UI (PKCE S256).
2. Cognito redirects to `https://app…/auth/callback?code=&state=`.
3. App exchanges code for tokens, stores access/id/refresh securely.
4. Calls backend with `Authorization: Bearer <access_token>`.
5. Middleware verifies JWT + `createCustomerIfMissing`.

Rebuild:

```bash
cd customer-app
flutter build web --release \
  --dart-define=API_URL=https://api.warmkelvin.com/api
cp -a build/web/. ../infra/www/app/
```

Nginx already SPA-routes `/auth/callback` via `try_files … /index.html`.

---

## 6. Admin dashboard

**Clients** list shows: name, email, verified, status, registration, last login, gallery count.

**Client detail** actions: Enable / Disable / Delete / Reset password / View Cognito details.

Creating a client **with email** while Cognito is enabled sends a Cognito invite email (no local password stored).

---

## 7. End-to-end checklist

- [ ] User pool + app client + domain live
- [ ] Callback/logout URLs match production app origin
- [ ] Instance role has cognito-idp admin actions
- [ ] `.env` Cognito vars set; backend healthy
- [ ] `GET /api/auth/cognito/config` returns `enabled: true`
- [ ] Flutter sign-in → Hosted UI → callback → galleries
- [ ] Access token rejected after disable
- [ ] Admin reset password triggers Cognito email
- [ ] Cross-studio gallery grant never returns foreign photos
- [ ] Legacy login blocked when `COGNITO_ALLOW_LEGACY_FALLBACK=false`

### Quick API smoke (after pool exists)

```bash
curl -sS https://api.warmkelvin.com/api/auth/cognito/config | jq .
# Sign in via app, copy access_token, then:
curl -sS https://api.warmkelvin.com/api/customers/me \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .
```

---

## 8. Migration from legacy loginId/password

1. Deploy Cognito with `COGNITO_ALLOW_LEGACY_FALLBACK=true`.
2. Admin re-invites clients by email (AdminCreateUser) **or** clients self-register.
3. First Cognito login with matching email links `cognitoSub` to the existing row.
4. Set `COGNITO_ALLOW_LEGACY_FALLBACK=false` and rebuild Flutter without legacy form.
