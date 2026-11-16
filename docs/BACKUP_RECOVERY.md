# Backup and recovery

Status: **NEEDS CONFIGURATION**. No evidence has been collected for the connected project's backup plan, recent successful backup, point-in-time recovery, off-site export, object-storage backup or restore drill. Migrations are not backups. Step 18 did not run a backup or restore.

## Provider capability versus configured protection

Supabase documents daily backups for eligible paid plans, plan-dependent retention and optional point-in-time recovery. These are capabilities, not verified settings for this project. Check Database → Backups for actual coverage and recent successful points. Database backup includes Storage metadata, not uploaded object bytes; protect objects separately. See [Supabase backups](https://supabase.com/docs/guides/platform/backups).

Record an accountable operator, project/region/PostgreSQL version, actual plan/retention, earliest/latest restore point, encrypted off-site strategy, access policy, object coverage and last drill result in a restricted runbook. Agree recovery point/time objectives; none are promised yet. Do not infer a contractual SLA.

## Recovery inventory

| Category | Required coverage |
| --- | --- |
| Database | Private `app` data, relationships, checks/exclusion constraints, extensions, indexes, RLS/grants and `drizzle.__drizzle_migrations`. |
| Financial history | Booking payment/refund/audit records separate from SaaS subscription checkout/event/audit records; preserve provider and deduplication IDs. |
| Auth/tenancy | Better Auth records, organization members/roles/branches and lifecycle/entitlements; decide session invalidation after incidents. |
| Objects | Bucket policies and actual bytes, path inventory/checksums; metadata alone is insufficient. |
| Deployment | Git revision, lockfile, environment names, domains, schedules and secret-manager references, never secret values. |
| Providers | Reconciliation evidence; restoring PostgreSQL cannot reverse a payment or unsend a message. |

For logical exports, use an operator-managed `pg_dump` or current Supabase backup flow with restricted credentials and encrypted off-site destination. Include private `app` and Drizzle schemas; inspect the archive. Check tool/version compatibility and provider-managed schema handling. Do not store dumps in Git or the web public directory.

## Staging restore drill

Run only in an independently verified disposable staging/recovery project. Never restore over production as a test.

1. Disable external email/WhatsApp/webhooks, payment checkouts and jobs. Do not copy production secrets.
2. Record source/target references, target fingerprint, app revision, journal and synthetic fixture counts. Take a backup and confirm completion.
3. Change a clearly named synthetic fixture after backup and record expected before/after values.
4. Restore to the separate recovery target using a reviewed provider/logical-restore procedure; plan for downtime.
5. Verify the fixture reverted, journal matches, tenant constraints/private grants remain and `bookings_active_resource_no_overlap` exists.
6. Verify users/memberships/customers/bookings, manual payment/refund net amounts and subscription history; no mixed venue/platform revenue.
7. Recover/read a known test object, verify checksum and access policy; confirm object metadata matches bytes.
8. Run smoke tests, one guest booking and independent-connection overlap acceptance. Check connection/role credentials without exposing them.
9. Record duration, data-loss window, errors and follow-ups. Re-enable only intentionally configured staging providers.

The drill remains NEEDS CONFIGURATION until evidenced. Repeat after material schema/provider changes and on the operator's approved cadence.

## Incident recovery

Preserve safe audit/log evidence and pause affected writes/outbound jobs. The responsible operator selects a recovery point and identifies transactions since that point. Obtain explicit approval before overwriting production. Restore into a separate project first where possible, validate integrity, then deliberately update target fingerprints/traffic.

Before reopening payments, reconcile provider transactions from the recovery point onward: successful external events may be absent after restore. Replay through idempotent domain handlers; never blindly increment money. Reconcile notification/webhook history to avoid duplicate sends. Check session handling, domains, storage and jobs, then reopen in stages.

Do not truncate booking/payment/audit/subscription history or migration journals to make recovery pass. Soft closure preserves history. Future deletion/export needs an approved retention policy, identity verification, legal review and handling of outstanding financial obligations.

## Remaining actions

- Confirm actual project backup retention and restore capability.
- Select encrypted off-site/object backup strategy and accountable operator.
- Complete the staging drill and agree RPO/RTO targets.
- Review provider version advisories before database upgrades. The September 2026 `btree_gist` advisory concerns floats containing NaN; Slotra's booking exclusion uses UUID/time-range keys, but live index/extension inventory still needs review. See [provider advisory](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).
- Record backup freshness and restore evidence; do not mark READY from credentials alone.
