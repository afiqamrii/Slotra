import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
import { AuthPage } from "@/components/auth-page";

describe("native authentication form fallback", () => {
  it.each(["login", "register", "forgot", "reset"] as const)("keeps %s credentials out of the URL before hydration", mode => {
    const html = renderToStaticMarkup(createElement(AuthPage, { mode, token: "synthetic-reset-token" }));
    // A browser can submit the server-rendered form before onSubmit is attached.
    // An omitted method becomes GET and serializes password/email into the URL.
    expect(html).toMatch(/<form\b[^>]*\bmethod="post"/);
  });

  it("does not offer a backslash destination as the sign-up redirect", () => {
    const html = renderToStaticMarkup(createElement(AuthPage, { mode: "login", nextPath: "/\\evil.example" }));
    expect(html).toContain("%2Fdashboard");
    expect(html).not.toContain("evil.example");
  });
});
