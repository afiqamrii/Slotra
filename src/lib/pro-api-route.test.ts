import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(() => { throw new Error("private database connection detail"); }) }));
import { GET, POST } from "@/app/api/v1/[collection]/route";

afterEach(() => vi.restoreAllMocks());
describe("Pro API safe failure boundary", () => {
  it.each([GET, POST])("returns the documented safe envelope when authentication storage is unavailable", async handler => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handler(new Request("https://app.example.test/api/v1/customers"),
      { params: Promise.resolve({ collection: "customers" }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "UNAVAILABLE", message: "The API is temporarily unavailable." } });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private database connection detail");
  });
});
