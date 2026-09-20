# Product specification

**Status:** Initial product direction. Capabilities below are planned unless explicitly identified as present in the repository.

## Identity and scope

Slotra is the temporary name for a commercial, multi-tenant sports venue booking and management SaaS from **Nexura Labs**. The product brand and public domain must remain configurable because the name may change. The repository now includes authentication, venue setup, booking, guest checkout, and a customer-payment foundation. A live gateway, SaaS subscription billing, and higher-plan analytics remain planned; see `ROADMAP.md` for implementation status.

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

The prices and monthly confirmed-booking allowances below are initial product decisions. Exact quota accounting, limits described as approximate, overage behavior, and billing implementation remain to be specified in `FEATURE_FLAGS.md` before release.

| Plan | Monthly price | Annual price | Confirmed bookings/month | Positioning |
| --- | ---: | ---: | ---: | --- |
| Starter | RM79 | RM790 | 200 | Take bookings online. |
| Professional | RM129 | RM1,290 | 1,000 | Take bookings and payments online. |
| Business | RM179 | RM1,790 | 3,000 | Automate and grow. |
| Pro | RM279 | RM2,790 | 10,000 | Scale your operation. |
| Enterprise | Custom | Custom | Custom | Custom requirements. |

**Professional** is the recommended, most popular plan. Higher plans always include everything in lower plans.

### Starter — “Take bookings online.”

Planned core functionality: one branch; up to approximately 10 resources; an owner account and one staff seat; multiple reasonable sessions or devices; a public booking page; guest and walk-in booking; booking calendar; customer database; basic pricing; operating hours; resource blocking and maintenance; payment tracking (total, paid, outstanding, and manual status); manual/offline collection such as Pay at venue and staff-recorded cash or bank transfer; email confirmation; basic dashboard and reports; and CSV export.

### Professional — “Take bookings and payments online.”

Everything in Starter, plus the 1,000-booking allowance, connected online payment gateway, full online payment, fixed and percentage deposits, automatic payment confirmation, payment history, provider-supported online refunds, a higher resource limit, approximately three staff seats, a professional dashboard, revenue trends, resource utilisation, peak-hour analytics, a booking heatmap, revenue by resource, cancellation and no-show analytics, returning-customer analytics, advanced reporting and exports, and scheduled reports.

### Business — “Automate and grow.”

Everything in Professional, plus the 3,000-booking allowance, higher resource and staff limits, peak/off-peak pricing, recurring bookings, memberships, packages or credits, promo codes, a waiting list, QR check-in, WhatsApp integration, automated reminders, customer segmentation, retention tools, advanced booking rules, and automation workflows.

### Pro — “Scale your operation.”

Everything in Business, plus the 10,000-booking allowance, multiple branches, a high resource allowance, more staff, multi-branch reporting and comparison, a custom domain, white-label options, advanced permissions, audit logs, automated campaigns, corporate accounts, an API, webhooks, advanced executive reporting, and priority support.

### Enterprise

Custom commercial terms and requirements. Specific entitlements are **undecided** and must be agreed before implementation.

## UX and language

Use plain business language in the interface: **Courts & Spaces** for `Resource`, **Pricing** for `PricingRule`, and **Opening Hours** for availability or operating-hour configuration. Do not expose implementation terms when a venue owner needs a clearer label.

The visual direction is premium, minimal, and professional. Prefer clear typography, excellent whitespace, subtle borders, restrained colour, Lucide-style icons, responsive layouts, and strong information hierarchy. Avoid a generic admin-template appearance, excessive gradients or glassmorphism, excessive shadows, giant rounded containers everywhere, clutter, unnecessary animation, and emoji icons. See `DESIGN_SYSTEM.md` for the evolving design rules.

## Technical intent

The installed application foundation is Next.js App Router, TypeScript, Tailwind CSS, ESLint, and `lucide-react` for icons. PostgreSQL, Supabase, Drizzle ORM, Better Auth, Zod, React Hook Form, TanStack Table, Recharts, date-fns, Vitest, and Playwright are intended for later phases, not installed dependencies or finalized integration decisions. Add a library only when the phase needs it and its role is clear.

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

See `ROADMAP.md` for phase status. No phase is marked complete by this specification.

## Open product decisions

Exact resource and staff caps above Starter, quota counting and reset rules, cancellation policy defaults, supported guest-facing manual bank-transfer instructions, Enterprise entitlements, supported languages, and final brand/domain are **undecided**. Starter does not include connected online checkout, online deposits, automatic provider confirmation, or provider-managed refunds. The current payment feature gates use a trusted organization plan code defaulting to Starter; no self-service plan purchase or subscription enforcement is implied.
