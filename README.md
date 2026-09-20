# Slotra

Visual foundation for a sports venue SaaS. The dashboard, public booking page, and account pages are previews with static data. Authentication, bookings, payments, and other business features are not connected.

## Run locally

```bash
npm ci
npm run dev
```

Visit `/` for the landing page, `/dashboard` for the workspace preview, `/book/smash-arena` for the public booking preview, and `/login` or `/register` for visual-only account pages.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

`npm start` serves a production build. No test runner is configured yet.

## Temporary branding

Set `NEXT_PUBLIC_PRODUCT_NAME` to change the display name and `NEXT_PUBLIC_BRAND_ACCENT` to a six-digit hex colour to change the shared accent. Review contrast when changing the accent.
