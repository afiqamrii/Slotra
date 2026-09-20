const requestedAccent = process.env.NEXT_PUBLIC_BRAND_ACCENT;

export const brand = {
  name: process.env.NEXT_PUBLIC_PRODUCT_NAME?.trim() || "Slotra",
  company: "Nexura Labs",
  accent:
    requestedAccent && /^#[0-9a-fA-F]{6}$/.test(requestedAccent)
      ? requestedAccent
      : "#176b5b",
} as const;
