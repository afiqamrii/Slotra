"use client";

import type { ReactNode } from "react";

export function BookingFilterForm({ children, initialSearch = "" }: { children: ReactNode; initialSearch?: string }) {
  return <form className="booking-filters" action="/bookings" method="get" onSubmit={event => {
    const form = event.currentTarget;
    const values = new FormData(form);
    // Searches span history by default; a chosen date still narrows the results.
    const search = String(values.get("q") ?? "").trim();
    if (search && search !== initialSearch) {
      const view = form.elements.namedItem("view");
      if (view instanceof HTMLInputElement) view.value = "all";
    }
  }}>{children}</form>;
}
