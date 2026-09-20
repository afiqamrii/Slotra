# Repository instructions

This repository is a production SaaS project. Read `docs/PRODUCT_SPEC.md` before significant work, then read the supporting document relevant to any architecture, UI, database, security, booking-logic, or feature-gating change. Inspect existing code and project patterns before introducing abstractions.

## Engineering rules

- Preserve strict multi-tenant isolation. Every tenant-owned record must be scoped to an organization.
- Never trust organization or branch IDs supplied by a client. Authorize access on the server for every operation.
- Keep booking, pricing, and payment business logic outside React UI components.
- Use strict TypeScript and validate all external input at the appropriate boundary.
- Keep the final product brand configurable; do not hard-code the temporary name where a configurable brand is appropriate.
- Do not implement fake functionality that appears production-ready.
- Avoid unnecessary dependencies and avoid rewriting unrelated working functionality.
- Update the relevant documentation whenever the architecture materially changes. Record unresolved decisions honestly.

## Completion checks for implementation tasks

Run the relevant lint, type-check, tests, and production build checks before finishing an implementation task. Fix errors introduced by the task. Current commands are `npm run lint`, `npm run typecheck`, and `npm run build`; run relevant test commands once tests exist. Report any check that cannot run.
