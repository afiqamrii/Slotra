# Plans and feature entitlements

**Status:** Customer-booking payment entitlements are enforced server-side from `organizations.plan_code`. SaaS subscription billing, self-service upgrades, quota enforcement, and non-payment feature gating do not yet exist.

## Initial plans

| Plan | Monthly | Annual | Confirmed bookings/month |
| --- | ---: | ---: | ---: |
| Starter | RM79 | RM790 | 200 |
| Professional | RM129 | RM1,290 | 1,000 |
| Business | RM179 | RM1,790 | 3,000 |
| Pro | RM279 | RM2,790 | 10,000 |
| Enterprise | Custom | Custom | Custom |

Professional is the recommended, Most Popular plan. Starter is “Take bookings online” with manual/offline payment only. Professional is “Take bookings and payments online” with gateway payments and deposits; Business and Pro inherit those features. See `PRODUCT_SPEC.md` for the planned feature sets.

| Feature | Starter | Professional | Business | Pro |
| --- | --- | --- | --- | --- |
| `ONLINE_PAYMENTS` | No | Yes | Yes | Yes |
| `DEPOSITS` | No | Yes | Yes | Yes |
| `ONLINE_REFUNDS` | No | Yes | Yes | Yes |

The centralized typed map is `src/lib/plan-entitlements.ts`; `src/lib/organization-entitlements.ts` reads the server-owned `organizations.plan_code` and enforces payment features at service boundaries. New and migrated venues default to `STARTER`. Only a trusted platform operator may assign a different code until SaaS billing and upgrade workflows exist; owners cannot self-upgrade by calling a payment action. The development-only TestProvider and ToyyibPay sandbox are additionally guarded and are not live gateways. Starter still tracks totals, paid/outstanding balances, and staff-recorded manual receipts/refunds.

## Intended approach

Payment policy changes, provider connection, online checkout creation, and online refund requests enforce the centralized map server-side. UI hiding is supplementary. A plan downgrade masks an old online policy/account for new bookings without deleting historical rows; already-created payment events continue to reconcile so funds are not lost. A future trusted plan-assignment workflow must review old online settings before re-enabling them on an upgrade. Subscription state and billing remain distinct from provider accounts. Avoid scattered plan-name checks and duplicate feature lists.

## Decisions pending

Exact resource and staff limits; quota counting and reset time zone; behavior at a limit; trials and grace periods; upgrades and downgrades; annual billing transitions; custom Enterprise overrides; grandfathering; and how feature availability is cached or invalidated. Do not imply these rules are settled in UI or code before they are specified.
