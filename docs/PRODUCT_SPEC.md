# Product specification

**Status:** Product direction plus implementation notes. Business is being implemented in Step 14; an entitlement or schema definition alone does not mean a capability is ready for customers. See `ROADMAP.md` for acceptance status.

## Identity and scope

Slotra is the temporary name for a commercial, multi-tenant sports venue booking and management SaaS from **Nexura Labs**. The product brand and public domain must remain configurable because the name may change. The repository now includes authentication, venue setup, booking, guest checkout, a customer-payment foundation, and Professional analytics. A live gateway and real SaaS subscription billing remain planned; see `ROADMAP.md` for implementation status.

The initial target customers operate badminton, pickleball, futsal, tennis, padel, basketball, squash, table-tennis, swimming-lane, golf-simulator, and other time-based sports facilities. The core architecture must remain sport-neutral and must not encode badminton-specific assumptions.

## Product principle

Provide powerful functionality while keeping everyday work extremely simple for owners and staff. A new owner should understand most common workflows in approximately five minutes. Common actions should take very few interactions. Reveal advanced configuration progressively.

## Domain language and hierarchy

The internal vocabulary is **Organization, Branch, Resource, Sport, Customer, Booking, Payment, Pricing Rule, Membership, Package, Promotion,** and **Automation**. The core hierarchy is:

```text
Platform
└── Organization
    └── Branch
        └── Resource
```

Every tenant-owned record must be organization-scoped. A branch or resource reference alone must never establish authorization. See `DATABASE.md` and `SECURITY.md` before implementing tenancy.

## Navigation and public booking

The intended owner navigation is **Home, Bookings, Calendar, Customers, Courts & Spaces, Payments, Reports, Grow, Settings**. Navigation can reveal plan-specific capabilities without changing the core information architecture.

Each organization is intended to receive a public booking URL similar to `book.productdomain.my/{organization-slug}`. The final domain and brand remain configurable. Public booking must support guests without mandatory account registration and must be mobile-first.

## Plans and pricing

The monthly prices and booking allowances below are product decisions. Starter quota counting and temporary grace are defined in `FEATURE_FLAGS.md`. Business limits are defined centrally, but live SaaS billing and Pro limits remain pending.

| Plan | Monthly price | Annual price | Confirmed bookings/month | Positioning |
| --- | ---: | ---: | ---: | --- |
| Starter | RM79 | RM790 | 200 | Run your bookings. |
| Professional | RM129 | RM1,290 | 1,000 | Understand your business. |
| Business | RM179 | RM1,790 | 3,000 | Automate and grow. |
| Pro | RM279 | RM2,790 | 10,000 | Scale your operation. |
| Enterprise | Custom | Custom | Custom | Custom requirements. |

**Professional** is the recommended, most popular plan. Higher plans always include everything in lower plans.

### Starter — “Run your bookings.”

Core scope: one branch; up to 10 non-disabled resources; one owner and one non-owner staff seat; multiple reasonable sessions or devices; public booking page; guest, staff, and walk-in booking; booking calendar; customer records; basic pricing and hours; blocking and maintenance; payment tracking and manual/offline collection such as Pay at venue, cash, or bank transfer; booking email notification foundation; basic dashboard and reports; and CSV export. Production email delivery requires a configured sender. Starter excludes connected online gateway checkout, deposits, advanced analytics, memberships, packages, recurrence, promo codes, WhatsApp, waitlists, multi-branch, custom domains, and API/webhooks.

### Professional — “Understand your business.”

Everything in Starter, plus the 1,000-booking allowance, a one-branch limit, up to 20 non-disabled resources, one owner and three non-owner staff seats; entitlement for venue-owned online payment gateway connection, full online payment, fixed and percentage deposits, automatic verified payment confirmation and provider-supported refunds; a professional dashboard, revenue trends, resource utilisation, peak-hour/heatmap views, revenue by resource, cancellation and no-show analytics, returning-customer analytics, filtered CSV and scheduled reports. A live provider is not yet implemented, so entitlement does not imply production card/FPX/DuitNow checkout. XLSX/PDF export and production email scheduling are follow-ups. See `REPORTING.md`.

### Business — “Automate and grow.”

Everything in Professional, plus 3,000 first-confirmed bookings per month, one branch, 50 non-disabled resources, one owner, and five non-owner staff seats. The Business product scope is peak/off-peak pricing, weekly recurring bookings, memberships, packages or credits, promo codes, a waitlist, QR check-in, WhatsApp integration, automated reminders, customer segmentation, retention tools, advanced booking rules, automation workflows, and Business-level analytics. Step 14 is implementing this scope incrementally; do not market an unfinished channel or workflow as live. Venue funds still flow to a venue-owned provider account when a production online gateway is eventually connected.

### Pro — “Scale your operation.”

Everything in Business, plus the 10,000-booking allowance, multiple branches, a high resource allowance, more staff, multi-branch reporting and comparison, a custom domain, white-label options, advanced permissions, audit logs, automated campaigns, corporate accounts, an API, webhooks, advanced executive reporting, and priority support.

### Enterprise

Custom commercial terms and requirements. Specific entitlements are **undecided** and must be agreed before implementation.

## UX and language

Use plain business language in the interface: **Courts & Spaces** for `Resource`, **Pricing** for `PricingRule`, and **Opening Hours** for availability or operating-hour configuration. Do not expose implementation terms when a venue owner needs a clearer label.

The visual direction is premium, minimal, and professional. Prefer clear typography, excellent whitespace, subtle borders, restrained colour, Lucide-style icons, responsive layouts, and strong information hierarchy. Avoid a generic admin-template appearance, excessive gradients or glassmorphism, excessive shadows, giant rounded containers everywhere, clutter, unnecessary animation, and emoji icons. See `DESIGN_SYSTEM.md` for the evolving design rules.

## Technical intent

The application uses Next.js App Router, TypeScript, Tailwind CSS, ESLint, `lucide-react`, Supabase PostgreSQL through server-only Drizzle, Better Auth, Zod, and Vitest. Add libraries only for implemented needs; do not infer that a proposed integration is installed or production-ready.

## Development phases

1. Application and design foundation
2. Authentication and tenancy
3. Onboarding, branches, and resources
4. Booking and availability engine
5. Owner booking and calendar operations
6. Public booking experience
7. Customers and payments
8. Starter reporting
9. Professional analytics
10. Business features
11. Pro and multi-branch features
12. SaaS billing, feature gating, and production hardening

See `ROADMAP.md` for phase status. This specification is not an acceptance checklist.

## Open product decisions

Resource and staff caps above Business, long-term quota billing periods, supported guest-facing manual bank-transfer instructions, Enterprise entitlements, supported languages, and final brand/domain are **undecided**. Business cancellation/reschedule cutoffs are optional venue policy, not an automatic refund rule. Starter does not include connected online checkout, online deposits, automatic provider confirmation, or provider-managed refunds. The plan code defaults to Starter. A nonproduction one-time ToyyibPay sandbox payment may assign Professional after server verification for testing; no live plan purchase, recurring subscription, or renewal is implied.
