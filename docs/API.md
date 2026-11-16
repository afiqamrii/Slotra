# Slotra Pro API v1

Base path: `/api/v1`. External integrations use `Authorization: Bearer <api-key>`; browser session cookies do not authenticate these endpoints. Owners/admins create keys in Settings → Integrations. A key is shown once; the database stores only a SHA-256 hash and short display prefix. Revoke compromised or unused keys. A key belongs to one organization and may be bound to one branch. It cannot access another tenant or branch. Pro entitlement, organization active state, scope, and a fixed 120-requests/minute per-key limit are checked server-side. A lower-tier downgrade makes keys unusable without deleting history.

Scopes: `bookings:read`, `bookings:write`, `customers:read`, `customers:write`, `resources:read`, `availability:read`. There is no default unrestricted master key. A creator may grant only scopes supported by their current effective permissions. Every API call rechecks the creator's active membership, corresponding domain permission, and current branch assignment, including reads. Removing/suspending the creator or removing the permission makes the key unusable for that operation. A selected-branch creator cannot use an organization-wide key. Branch-bound keys also require an active organization-owned branch, cannot create organization-wide customers, and customer reads show only customers with bookings in that branch.

| Endpoint | Scope | Notes |
| --- | --- | --- |
| `GET /bookings?from=<ISO>&to=<ISO>&branchId=<UUID>&page=1` | `bookings:read` | Defaults to the next 30 days; max 93-day window; 50 rows/page. |
| `POST /bookings` | `bookings:write` | `branchId`, `resourceId`, `startAt`, `endAt`, existing `customerId` or minimal `newCustomer`, optional `notes`. Source is forced to `API`. Price and availability are calculated by the booking engine; client price is ignored. |
| `GET /customers?q=<text>&page=1` | `customers:read` | Tenant-scoped, 50 rows/page. |
| `POST /customers` | `customers:write` | `name`, `phone`, optional `email`; organization-wide keys only. |
| `GET /resources?branchId=<UUID>&page=1` | `resources:read` | Tenant/branch-scoped, 50 rows/page. |
| `GET /availability?branchId=<UUID>&resourceId=<UUID>&date=YYYY-MM-DD&durationMinutes=60` | `availability:read` | Repeat `resourceId` up to 20 times. Calls the existing availability engine. |

Use ISO timestamps with timezone offset, e.g. `2026-10-05T19:00:00+08:00`. Example:

```bash
curl -H 'Authorization: Bearer YOUR_KEY' 'https://YOUR_SLOTRA_HOST/api/v1/resources?page=1'
```

Responses use `{ "data": ... }` and list responses include `page`. Errors use `{ "error": { "code": "...", "message": "..." } }`. 400 means invalid request, 401 invalid/missing key or revoked creator access, 403 wrong scope or branch, 409 booking conflict, 429 rate limit, and 503 temporary service unavailability (including authentication storage failure). Raw database/provider errors are not exposed. V1 is additive; incompatible contracts require `/api/v2`. Pagination currently uses a bounded page number (maximum 1,000), not a cursor. There are no update/delete endpoints yet. No public webhooks are delivered yet; see [WEBHOOKS.md](WEBHOOKS.md).
