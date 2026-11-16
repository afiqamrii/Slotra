# Booking review before main merge

This follow-up reviews the workspace upgrade and fixes four concrete usability and booking issues.

- Booking date filters now include every reservation overlapping the selected local day. An overnight booking remains visible after midnight; a booking ending exactly at midnight does not appear on the following day. Pagination adds an ID tie-breaker for equal start times.
- A branch-authorized custom role with `booking:create` can request available slots without also receiving `booking:view`. The availability response contains slot boundaries, not other bookings or customer details. After saving, creator-only staff see an immutable booking reference and session summary, can return Home, or start another reservation with refreshed slots. Users with viewing permission retain detail navigation.
- Week calendar cards display explicit status labels so status is understandable without relying on colour.
- Repeated local times at daylight-saving fallback show their UTC offsets in staff and public booking choices and summaries. Ordinary labels remain unchanged. The shared formatter handles non-hour transitions, including Lord Howe's 30-minute fallback.

## Verification

- Full `npm test`: **487 tests passed across 47 files**, including three booking-domain regressions, four route/status cases and five timezone-label cases added by this review.
- Whole-repository ESLint passed after the final component adjustment.
- Production build with `npm run build -- --webpack` passed, including TypeScript and static page generation. The first sandboxed build could not create a generated directory; the successful rerun used the normal host permissions.
- Independent source review found no remaining issue in the changed permission checks, overlap boundaries, pagination, confirmation snapshot or duplicate-submit transitions.

The experimental 3D/Flat reception workspace is a standalone sample-data concept and is deliberately excluded from this application change until the user reviews its visual direction. No production database, payment provider or message delivery was used during verification.
