import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import "./globals.css";
import "./professional.css";

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: "A clearer way to run your sports venue.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={{ "--brand": brand.accent } as CSSProperties}>
      <body><a className="skip-link" href="#main-content">Skip to content</a>{children}</body>
    </html>
  );
}
