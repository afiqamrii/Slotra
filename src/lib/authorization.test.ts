import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error("redirect:" + path); },
  notFound: () => { throw new Error("not-found"); },
}));
vi.mock("@/lib/auth", () => ({
  isAuthConfigured: () => true,
  getAuth: async () => ({ api: { getSession: async () => null } }),
}));

import { requireUser } from "@/lib/authorization";

describe("protected workspace boundary", () => {
  it("redirects a request without a valid session to login", async () => {
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });
});
