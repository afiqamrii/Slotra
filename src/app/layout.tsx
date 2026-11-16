import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { productUrls } from "@/lib/product-urls";
import "./globals.css";
import "./professional.css";
import "./business.css";
import "./billing.css";
import "./integrations.css";

export const metadata: Metadata = {
  metadataBase: new URL(productUrls.marketing),
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: "A clearer way to run your sports venue.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" style={{ "--brand": brand.accent } as CSSProperties}>
      <body><a className="skip-link" href="#main-content">Skip to content</a>{children}</body>
    </html>
  );
}
