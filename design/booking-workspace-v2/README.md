# Visual booking workspace concept

`index.html` is a self-contained design preview. Open it directly or serve this directory locally. It has no external scripts, fonts, images or packages. All venue, customer, court, booking and payment details are synthetic sample data. No request is sent and no real booking is written.

## Design direction

- One visual reception screen: status counts, court map, next arrivals and a compact evening schedule.
- Light isometric depth conveys the court layout; a Flat toggle preserves the same selection and interactions.
- Labels and status text remain visible, including on coloured courts. Short action labels replace explanatory paragraphs.
- Booking details use an accessible native dialog. Controls support keyboard focus, Escape dismissal, restored focus and reduced motion.
- Phone layout stacks the court overview and booking queue; the timeline scrolls inside its panel.

## Implemented preview interactions

1. Switch Flat / 3D and select a court.
2. Filter by available, playing, arriving or maintenance; clear zero-result filters.
3. Move among three sample days; counts, queue and schedule update together.
4. Open an available court, choose a time/duration and enter a sample customer name. Preview booking shows the selected values and explicitly says nothing was reserved. Duration choices prevent running past the sample court's next reservation.
5. Open queue cards or timeline sessions to inspect details. Check-in/completion are clearly identified previews and do not alter stored data.
6. Show all six courts in the timeline.
7. Use Ctrl/Cmd+K or the search control to find a court or sample customer.
8. Use the phone navigation menu and Escape to dismiss it.

## Verification boundary

Inline JavaScript passes `node --check`. Browser verification covered 3D/Flat switching, opening the booking drawer, submitting a sample preview, quick-search filtering, Escape dismissal and restored focus. A 390px iframe verified the phone layout and menu/Escape interaction without horizontal document overflow. No console warnings or errors were captured in the desktop preview.

This file is deliberately separate from production application routes until the user reviews the visual direction. The sidebar's secondary destinations demonstrate navigation placement; they do not impersonate complete reporting, payment or settings applications. The 3D layout is illustrative, not a measured venue floor plan. `mobile-review.html` opens the same preview inside a phone-sized viewport.

Screenshots: [3D overview](preview-3d.png), [Flat overview](preview-flat.png), [Phone layout](preview-mobile.png).
