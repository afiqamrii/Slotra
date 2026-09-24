# Database foundation

**Status:** Migrations through 0019 are applied to the connected Slotra Supabase project. Step 14 Business migrations 0017–0019 were applied after SQL and isolated-database checks; read-only verification found 20 Drizzle migration entries and the Business tables present. The database layer is server only. The ToyyibPay hosted-bill sandbox handles booking-payment and one-time Professional plan tests; no live online payment gateway is connected.

## Step 14 Business schema — applied

`0017_polite_anita_blake.sql` adds `pricing_rules`, `recurring_series`, nullable `bookings.recurring_series_id`, `membership_plans`, `customer_memberships`, `package_plans`, `customer_packages`, `package_usages`, `promotions`, `promotion_redemptions`, `waitlist_entries`, and `customer_tags`. Rules store organization/branch/sport, optional space, weekdays, local minute range, and integer minor-unit price. A series stores a weekly local rule and links to individually created bookings; it is not itself a booking or quota unit. Membership and package applicability is optional sport/space ID arrays in JSONB, validated against the organization by the service. Customer package balances are integer **minutes**, constrained between zero and issued total. Each applied or reversed package use has one booking-linked ledger row. Promotions store UTC validity, server-calculated discount terms, limits, and used count; redemption rows retain the realized discount. Waitlist entries store the requested absolute range and contact/notification state, **not** a guaranteed hold.

`0018_keen_tyrannus.sql` adds organization-owned `business_booking_policies` plus `automation_workflows` and `automation_executions` foundations. Policy values are bounded for minimum notice, maximum advance days/duration, buffer minutes, and cancellation/reschedule cutoffs. Workflow trigger/action combinations are checked by the schema; execution rows carry a unique workflow/run key and safe status/error summary. A table existing does not establish a configured WhatsApp sender or a running scheduler.

`0019_secret_dazzler.sql` adds `membership_credit_usages`, one tenant-scoped usage row per booking with applied/reversed status and a composite customer-membership relationship. Customer memberships retain their remaining-minute balance; staff-selected monthly credit use debits it inside the booking transaction and cancellation re-credits it once. This is a manually assigned, bounded membership period; automatic renewals, replenishment, and membership charges are not implemented.

All three migrations retain the private `app` boundary: new tables enable RLS without direct browser policies and revoke PUBLIC table privileges. Composite organization foreign keys bind child records to the same tenant; services must still authorize membership and scope every query because the server database credential is privileged. The configured main Supabase migration journal now contains 20 entries and read-only checks found the Business tables. No Business fixture, membership purchase, package sale, or promotion redemption was part of the migration; do not seed those into the main project.

## Sandbox Professional upgrade schema

`0016_lumpy_spirit.sql` adds private `app.plan_upgrade_attempts` for owner-initiated, one-time Starter → Professional sandbox tests. It stores organization/actor, fixed MYR amount snapshot, provider bill/reference, pending/processing/paid/failed/expired state, expiry, and verification timestamps. A partial unique key permits only one active attempt per organization; provider bill codes are unique. RLS is enabled with no public policy and PUBLIC grants are revoked. Immediately after that migration, read-only checks found 17 migration journal entries, RLS enabled, zero attempts, and the then-two existing organizations on Starter. No test bills or plan changes were initiated as part of the migration. A later read-only organization query on 25 September 2026 found Arena 27 and Badminton Panji on Professional and Cheras Sport Center on Starter.

## Professional scheduled-report schema

`0015_chubby_psynapse.sql` adds private `app.report_schedules` (organization, creator, type, weekly/monthly frequency, JSON email recipients, timezone snapshot, next due instant, active flag) and `app.report_deliveries` (tenant/schedule, period, recipient, delivery status, provider ID, safe failure reason). A composite tenant/schedule FK prevents cross-organization delivery association. A unique schedule/period/recipient key prevents duplicate normal runs. The generated migration was reordered to create the parent composite unique index before its referencing FK. Both tables enable RLS with no direct browser policies and revoke PUBLIC privileges. No booking/payment tables or production data are rewritten. See `REPORTING.md`.

Immediately after application to the configured main Supabase project, read-only verification found 16 Drizzle journal entries, both new tables with RLS enabled, zero schedule/delivery rows, and the then-two existing organizations on Starter. No plan assignments, schedules, emails, or demo records were written as part of that migration. These counts and assignments are historical post-migration snapshots, not current totals.

## Schema overview

The private PostgreSQL `app` schema contains the following core venue tables (alongside auth, invitation, pricing, and booking tables): `users`, `organizations`, `organization_members`, `branches`, `sport_types`, `resources`, `operating_hours`, `resource_blocks`, and `customers`. `sport_types` is a global editable catalog, seeded with the initial sports. Organizations are globally unique by slug; branches are unique by organization and slug; resources are unique by organization, branch, and name. Membership roles are `OWNER`, `ADMIN`, `MANAGER`, `STAFF`, `VIEWER`; statuses are `ACTIVE`, `INVITED`, `SUSPENDED`. Resources have `ACTIVE`, `MAINTENANCE`, `DISABLED` statuses. Database checks enforce these current values.

`users` has Better Auth's core fields, including optional `image`. Better Auth integration must map its user model to `app.users` and use UUID generation consistently. Better Auth maps to `app.users`; its password hash resides in `accounts`, with `sessions`, `verifications`, and `rate_limits` supporting auth. Do not add a second user identity.

## Tenancy and access

Every tenant table contains `organization_id`. Composite foreign keys bind resources to branches and bind blocks and operating hours to resources within the **same organization and branch**. The private `app` schema has no browser/Data API grants. Row level security is enabled without policies as a second layer of defense; a future direct client integration requires a separately reviewed policy design. The server connects with privileged database credentials and must still authorize every request against membership and organization scope before accessing tenant data. Client-provided organization or branch IDs never establish authorization. Organization membership and invitation services enforce this boundary for the current routes.

## IDs and timestamps

All primary keys are database-generated UUIDs. Absolute instants use PostgreSQL `timestamp with time zone`; the application stores and compares UTC instants. PostgreSQL normalizes `timestamptz` values to instants; display uses each branch's IANA timezone. `created_at` and `updated_at` default to the insertion time. Future write paths must explicitly set `updated_at` when changing a record. Organizations default to `Asia/Kuala_Lumpur`, `MYR`, and `en-MY` in one database definition. Branches default to Malaysia and the Kuala Lumpur timezone; onboarding must choose the correct values for other locations.

## Opening hours and blocks

`operating_hours` uses local weekday `0` Sunday through `6` Saturday. `start_minute` is 0–1439 from the start of that day; `end_minute` may be up to 2880 to represent a close after midnight (for example 08:00–00:00 is `480`–`1440`). A null `resource_id` is the branch schedule; a non-null value is a resource schedule. The Phase 4 engine interprets these hours in the branch timezone and rejects overlapping resource blocks. `resource_blocks` stores absolute start/end instants and optional reason and creator; types are `MANUAL`, `MAINTENANCE`, `PRIVATE_EVENT`, and `OTHER`.

## Indexes and deletion

Indexes cover organization membership, organization/branch lookup, resource status, weekly hours, blocks by resource/start time, and customers by organization/phone or email. Customer phone is indexed, not unique, because shared numbers and duplicate contacts may be legitimate. Normalization and deduplication remain future decisions. Users' email is unique without case sensitivity. Core entities use disable or status fields where needed. Foreign keys have no cascading deletes; retention and deletion workflows remain pending.

## Environment and migration workflow

`.env.example` documents the server-only `DATABASE_URL`; copy it to an ignored `.env.local` and replace the placeholder with the project's direct or session-pooler PostgreSQL URL for local development. Serverless production deployments must use Supabase's transaction-pooler URL on port 6543; `src/db/client.ts` limits each production instance to one connection so horizontally scaled functions do not exhaust session-mode clients. The public Supabase URL and publishable key are not database credentials and are not needed for this server-only foundation. Never use a `NEXT_PUBLIC_` prefix for the database URL. The database client module is protected with `server-only` and validates its URL when `getDb()` first runs, allowing credential-free builds.

Use `npm run db:generate` after schema edits, inspect the SQL in `drizzle/`, then apply with `npm run db:migrate` to a **fresh database** with `DATABASE_URL` set. This keeps a Drizzle migration journal. Do not use schema push for deployment. Review production migrations and back up data before application. The first three migrations were applied to Supabase project `gxcnihjwkzobedgmabux` through the connected Supabase migration tool. Their hashes and timestamps were recorded in `drizzle.__drizzle_migrations`, so subsequent Drizzle migrations can follow the same journal. Verify this journal before using `db:migrate` on a database modified by other tooling. The initial migration enables RLS and revokes public access on the private schema; maintain that boundary in later migrations.

## Development seed

Set `ALLOW_DEV_SEED=true` and run `npm run db:seed` only against a development database after migration. `NODE_ENV=production` blocks the script. The seed is idempotent for Smash Arena, Main Venue, 11 catalog sports, two assigned sports, four badminton courts, two pickleball courts, base rates, weekly hours, three customers, and dated sample bookings. It creates no users or memberships. A remote Supabase URL additionally requires `ALLOW_REMOTE_DEV_SEED=true`; never set that for the connected main project. Never seed a production database. The connected Slotra project was not seeded because it is the main project and no development-only database URL was supplied. The Supabase security advisor reports nine informational `rls_enabled_no_policy` notices; this is expected for the private schema until the future authorization design is specified.

`npm run db:seed:professional-demo -- --apply` is a separate, guarded fixture for the dedicated `professional.owner@example.test` tenant. It resolves the verified owner membership, requires that organization to be on Professional, locks that organization, and scopes every write to it. The idempotent `A27-` booking reference namespace prevents duplicate activity. The fixture uses fictional `.example` contacts and creates Arena 27 Sports Hub, eight spaces across four sports, 140 customers, approximately three months of varied bookings, matching status history and usage records, manual payment/refund history, and maintenance/private-event blocks. It must not be repointed at a real customer tenant.

## Pending schema decisions

Tenant-specific RLS policies if direct client access is introduced; custom tenant sports; invitation email delivery and retention; operating-hour exceptions and overlap handling; production concurrency acceptance; blended or exceptional pricing beyond the Business start-time rules; real-provider payment integration; customer normalization; deletion/retention; and backup/restore remain undecided. Review those areas in their relevant phases.



## Phase 3 migration

`0003_panoramic_gravity.sql` adds organization contact/address, display name, country, and onboarding completion time. `organization_sports` links an organization to multiple global catalog sports. `base_prices` stores one branch/sport rate in integer minor units with a 60-minute basis, separate from generic resources so future pricing rules need not overload a resource column. The migration idempotently inserts the eleven initial global sports if absent. New tables are in private `app`, have RLS enabled without public policies, and revoke PUBLIC table privileges. Composite branch foreign keys retain tenant integrity.

Onboarding writes one branch weekly schedule row per open weekday. A missing row means closed; end minutes through 2880 permit overnight close. It does not infer availability. The `onboarding_completed_at` timestamp is written with the other setup records in one transaction. Existing organizations stay incomplete until an owner runs setup. `logo_url` is not changed by this phase; uploads need a separately reviewed storage design.

Migration `0003_panoramic_gravity.sql` was applied to the connected main Supabase project on 20 September 2026 after explicit owner approval. The first three live Drizzle journal hashes matched the local files before application; journal entry 4 now records 0003. Read-only verification confirmed the new tables and completion column, all 11 catalog sports, and the formerly failing organization-sports join. The private-schema RLS-without-policy notices remain expected; no Data API grants were added. A separate development database and manual browser acceptance are still pending.



## Phase 4 booking schema (applied to Supabase)

`0004_flashy_enchantress.sql` creates `bookings` and `booking_status_history`, adds resource advance-window defaults, and a composite organization/customer key. Booking/resource and booking/customer composite foreign keys prevent cross-tenant references. It enables RLS without direct browser policies, revokes PUBLIC table access, and installs `btree_gist` for the partial active-booking exclusion constraint. The generated SQL was reordered so composite unique indexes exist before their referencing foreign keys; it was verified in PGlite with the extension loaded. Follow-up migration `0005_soft_wrecker.sql` expands block types from the existing Phase 3 constraint. Both migrations were applied to the connected Slotra Supabase project on 20 September 2026 after the Courts & Spaces page failed on the missing advance columns. Read-only verification confirmed six Drizzle journal entries, both new columns, the overlap exclusion constraint, and the exact formerly failing resource query. Independent-connection concurrency acceptance remains pending.

The exclusion constraint is the authoritative double-booking barrier, not merely an availability index. B-tree indexes cover branch/start and resource/start access paths; the partial GiST index covers active overlapping time ranges. All money is stored in minor units with arithmetic and nonnegative checks. `booking_status_history` is immutable application history; no cascade deletes were introduced. See `BOOKING_ENGINE.md` for statuses, timezone, pricing, and concurrency decisions.

## Phase 5 history migration

`0006_graceful_miek.sql` adds nullable `previous_resource_id`, `new_resource_id`, `previous_total_amount`, and `new_total_amount` columns to `app.booking_status_history`. These extend reschedule audit records for a changed space/duration and server repricing; they do not create a second pricing source or payment model. The migration was applied to the connected Supabase project on 20 September 2026. Read-only verification found all four columns and seven Drizzle journal entries. No development seed or demo bookings were written to this main project.

## Phase 6 public-booking migrations

`0007_flaky_madelyne_pryor.sql` adds nullable `bookings.public_access_token_hash` with a unique index. Staff and prior bookings remain null. Public guest creation generates 32 random bytes, stores only their SHA-256 hex digest, and returns the opaque URL token once. `0008_worthless_expediter.sql` adds `organizations.is_active boolean not null default true` so public resolution can reject a suspended venue independently of onboarding and branch status. Both are additive and were applied through `npm run db:migrate` to the configured Supabase connection on 20 September 2026. No demo seed was run against that connection. Public rate-limit counters reuse `app.rate_limits`; no new public grants, RLS policies, or payment tables were added.

## Phase 7 payment schema (applied)

`0009_steady_stephen_strange.sql` adds `organization_payment_settings`, `organization_payment_accounts`, `payments`, `refunds`, `payment_webhook_events`, and `payment_audit_logs` in private `app`. It adds booking `payment_requirement`, `required_now_minor`, and `hold_expires_at` snapshot columns, defaulting existing bookings to NO_UPFRONT/0/null. New financial amounts are positive integer minor units; status/type/policy checks, organization-scoped composite foreign keys, unique provider event/payment IDs, partial default-account uniqueness, and lookup indexes provide integrity. All six new tables have RLS enabled without public Data API grants and explicitly revoke PUBLIC table privileges. No credentials or card details are stored.

The prior exclusion constraint was transactionally replaced to include AWAITING_PAYMENT rows only when `hold_expires_at` is non-null, preserving legacy non-hold rows. It cannot include a volatile expiration predicate; the service sweeps expired rows under resource locks before creation, and the protected sweep endpoint should run on a schedule before production online payment. Before applying to the configured Supabase project, read-only preflight found nine journal entries, three bookings, zero awaiting-payment rows, and no payment tables. `npm run db:migrate` succeeded; read-only verification found ten journal entries, all six RLS-enabled tables, and the new exclusion predicate. No financial seed/test rows were written to the connected project. See `PAYMENTS.md`.



## Plan assignment migration

`0012_massive_marvel_zombies.sql` adds `organizations.plan_code varchar(20) NOT NULL DEFAULT 'STARTER'` with a check for STARTER, PROFESSIONAL, BUSINESS, and PRO. This is a trusted entitlement assignment, not a subscription or invoice table. Existing two venues defaulted to Starter; one existing connected sandbox account row was retained but cannot initiate new online checkout under Starter. No booking, payment, or refund rows were rewritten. The migration was tested in PGlite, inspected as two additive statements, and applied to the approved connected Supabase project after read-only preflight confirmed 12 journal entries and no existing plan column. Read-only post-apply verification found 13 journal entries, two Starter venues, and the check constraint. Future trusted plan assignment must review any stored online policy before reactivation on upgrade.

## Follow-up integrity migrations

`0010_white_dragon_man.sql` requires a non-null hold timestamp whenever `required_now_minor > 0`, adds a composite payment/booking unique key and refund foreign key so a refund cannot point at a different booking, and adds a nullable unique organization-scoped payment retry key. `0011_broken_dragon_man.sql` adds the corresponding refund retry key. Both were applied after a read-only preflight found no live payments, refunds, or invalid holds. Post-apply verification found 12 Drizzle journal entries, both constraints and both retry-key indexes. Existing bookings retain NO_UPFRONT/0/null; no payment test data was added to the connected project.

## Starter usage and notification migrations

`0013_rare_doctor_faustus.sql` adds private `app.booking_usage_records`. Its unique `(organization_id, booking_id)` key prevents double-counting first confirmation; `(organization_id, period_start_at)` indexes month lookups. The composite booking FK preserves tenant ownership. Period start/end and confirmation instant are UTC `timestamptz`. It backfills the earliest CONFIRMED status-history event for each existing booking, including now-cancelled bookings, then enables RLS and revokes PUBLIC grants.

`0014_green_chronomancer.sql` adds private `app.notification_records` with tenant/booking FK, unique organization/event key, type/channel/status, recipient, provider message ID, sent time, and safe failure reason. It is a booking-email outbox, not a WhatsApp/SMS implementation. Both additive migrations were applied to the configured Supabase project after a 13-entry preflight; post-apply read-only verification found 15 journal entries, five backfilled usage records, zero notification rows, and RLS enabled on both tables. No demo data or email was sent to the main project. A future retry worker and retention policy remain pending.
