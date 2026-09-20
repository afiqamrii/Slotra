# Database foundation

**Status:** Thirteen Drizzle migrations (through 0012) are applied to the connected Slotra Supabase project as of 20 September 2026. The database layer is server only. Authentication, tenancy, venue setup, booking operations, guest booking, and the manual/development-test payment foundation are implemented. A ToyyibPay hosted-bill sandbox adapter requires no additional tables; a live online payment gateway is not connected.

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

`.env.example` documents the server-only `DATABASE_URL`; copy it to an ignored `.env.local` and replace the placeholder with the project's direct or session-pooler PostgreSQL URL. The public Supabase URL and publishable key are not database credentials and are not needed for this server-only foundation. Never use a `NEXT_PUBLIC_` prefix for the database URL. The `src/db/client.ts` module is protected with `server-only` and validates its URL when `getDb()` first runs, allowing credential-free builds.

Use `npm run db:generate` after schema edits, inspect the SQL in `drizzle/`, then apply with `npm run db:migrate` to a **fresh database** with `DATABASE_URL` set. This keeps a Drizzle migration journal. Do not use schema push for deployment. Review production migrations and back up data before application. The first three migrations were applied to Supabase project `gxcnihjwkzobedgmabux` through the connected Supabase migration tool. Their hashes and timestamps were recorded in `drizzle.__drizzle_migrations`, so subsequent Drizzle migrations can follow the same journal. Verify this journal before using `db:migrate` on a database modified by other tooling. The initial migration enables RLS and revokes public access on the private schema; maintain that boundary in later migrations.

## Development seed

Set `ALLOW_DEV_SEED=true` and run `npm run db:seed` only against a development database after migration. `NODE_ENV=production` blocks the script. The seed is idempotent for Smash Arena, Main Venue, 11 catalog sports, two assigned sports, four badminton courts, two pickleball courts, base rates, weekly hours, three customers, and dated sample bookings. It creates no users or memberships. A remote Supabase URL additionally requires `ALLOW_REMOTE_DEV_SEED=true`; never set that for the connected main project. Never seed a production database. The connected Slotra project was not seeded because it is the main project and no development-only database URL was supplied. The Supabase security advisor reports nine informational `rls_enabled_no_policy` notices; this is expected for the private schema until the future authorization design is specified.

## Pending schema decisions

Tenant-specific RLS policies if direct client access is introduced; custom tenant sports; invitation email delivery and retention; operating-hour exceptions and overlap handling; production concurrency acceptance; advanced pricing and real-provider payment integration; customer normalization; deletion/retention; and backup/restore remain undecided. Review those areas in their relevant phases.



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

