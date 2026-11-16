/** Read-only deployed smoke checks. No payment, booking, email, seed, or migration writes. */
const base = new URL(process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000");
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
  throw new Error("SMOKE_BASE_URL must be a plain HTTP(S) origin without credentials.");
}
const origin = base.origin;
const venueSlug = process.env.SMOKE_VENUE_SLUG;
if (venueSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(venueSlug)) throw new Error("Invalid SMOKE_VENUE_SLUG.");
const timeout = 15_000;
let failures = 0;
let skipped = 0;

async function check(label, path, verify) {
  try {
    const response = await fetch(new URL(path, origin), { redirect: "manual", signal: AbortSignal.timeout(timeout) });
    const body = await response.text();
    if (!verify(response, body)) throw new Error("Unexpected response");
    console.log(`PASS ${label}`);
  } catch {
    failures++;
    // Do not print response bodies, URLs with tokens, cookies, or internal errors.
    console.error(`FAIL ${label}`);
  }
}

await check("marketing page", "/", (response, body) => response.ok && /<html[\s>]/i.test(body));
await check("login page", "/login", (response, body) => response.ok && /<form[\s>]/i.test(body));
await check("dashboard rejects anonymous access", "/dashboard", (response, body) => {
  if ([302, 303, 307, 308].includes(response.status)) {
    const redirect = response.headers.get("location");
    return Boolean(redirect && new URL(redirect, origin).pathname === "/login");
  }
  // Next may stream a server redirect as a 200 HTML shell; accept it only when login UI is present
  // and no authenticated workspace marker is rendered. Browser verification confirms the final URL.
  return response.status === 200 && (/Welcome back|\/login/.test(body)) && !/workspace-shell|FRONT DESK/.test(body);
});
await check("health readiness", "/api/health", (response, body) => {
  try { return response.ok && JSON.parse(body).status === "ok"; } catch { return false; }
});
await check("API rejects anonymous requests", "/api/v1/resources", response => response.status === 401);

if (venueSlug) {
  await check("public venue resolves and initial availability renders", `/book/${venueSlug}`, (response, body) =>
    response.ok && /public-page/.test(body) && /public-booking|public-flow|Choose a date|Choose a time|No available times|Choose your/i.test(body) &&
    !/Times are temporarily unavailable|Application error|Internal Server Error/i.test(body));
} else {
  skipped++;
  console.log("SKIP public venue: set SMOKE_VENUE_SLUG to a staging fixture slug.");
}

console.log("MANUAL REQUIRED: authenticated dashboard, guest booking submission, owner calendar visibility, and mobile flow.");
console.log(`Smoke results: ${failures} failed; ${skipped} skipped. No records were created.`);
process.exitCode = failures ? 1 : 0;
