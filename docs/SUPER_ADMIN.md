# Super Admin

/admin is a separate platform area, outside the venue workspace. Access requires an authenticated app.users row with platform_role=SUPER_ADMIN. Organization OWNER/ADMIN does not grant platform access. Every read and mutation checks the platform role server-side; no client-supplied role or selected organization is trusted.

## Capabilities

- Platform overview: total/effective lifecycle counts, plan distribution, trial/paid/failed renewal counts, bookings created this UTC month, MRR.
- Paginated organization directory (50 rows), name/slug search and detail with owner, subscription, usage and bounded audit history.
- Suspend/reactivate/soft-close, extend an unpaid trial, expiring feature or additional-limit override, revoke override.

Sensitive changes require exact venue-slug confirmation plus a reason. Overrides expire within 90 days, use known central feature/limit keys, record the actor, and newest active override per key wins. LIMIT values add allowance; FEATURE is 0 or 1. No arbitrary JSON/permission role elevation is offered. Expiry is checked during each entitlement resolution. Closure/suspension preserves all data and uses ADMIN lifecycle source; renewal cannot silently restore an administratively suspended venue.

Reactivation removes the administrative hold, not an expired subscription restriction. Trial extension is only for an unpaid NONE-provider trial, never converting a paid subscription into a free trial or silently removing an administrative suspension. Audit entries contain bounded operational fields, reasons and timestamps, not credentials or full provider payloads.

## Metrics

Database aggregation calculates effective state even before scheduled reconciliation. MRR includes only effective ACTIVE production subscriptions: monthly catalog price or annual catalog price / 12. NONE, LEGACY, DEVELOPMENT, trials, cancellations, expiry and administrative suspension/closure are excluded. These are recurring revenue estimates, not cash/bank-accounting or a claim that a production provider is connected. Enterprise distribution is not fabricated.

## Provisioning

No Super Admin is auto-created, inferred from email, or assigned by migration. A trusted database operator must verify an existing user's identity and explicitly provision/revoke platform_role in the private app.users table. Use exact user ID, transaction, one-row confirmation and an infrastructure audit/change ticket. Never expose this through tenant settings or public signup. Example with a placeholder only:

```sql
BEGIN;
SELECT id, email, platform_role FROM app.users WHERE id = '<verified-user-uuid>' FOR UPDATE;
UPDATE app.users SET platform_role = 'SUPER_ADMIN' WHERE id = '<verified-user-uuid>';
COMMIT;
```

No real account has been provisioned by Step 16. Local acceptance fixtures may use a separate disposable database. There is no impersonation, hard deletion, SSO, contractual SLA, enterprise environment or general-purpose platform data editor in this phase.
