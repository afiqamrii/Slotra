/** Disposable local browser fixture. Never reads DATABASE_URL or a real .env file. */
import { randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { hashPassword } from "better-auth/crypto";

if (process.env.NODE_ENV === "production" || process.env.VERCEL)
  throw new Error("The disposable browser fixture can run locally only.");
for (const file of [".env", ".env.local", ".env.development", ".env.development.local"])
  if (existsSync(resolve(file))) throw new Error("Use an isolated checkout without environment files for browser verification.");
const postgres = new PGlite({ extensions: { btree_gist } });
await postgres.waitReady;
const journal = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8"));
for (const { tag } of journal.entries) {
  for (const statement of readFileSync(resolve(`drizzle/${tag}.sql`), "utf8").split("--> statement-breakpoint"))
    if (statement.trim()) await postgres.exec(statement);
}

const password = randomBytes(24).toString("base64url"), userId = randomUUID();
const email = "integration.owner@example.test";
await postgres.query("insert into app.users(id,email,name,email_verified) values($1,$2,$3,true)", [userId, email, "Integration Test Owner"]);
await postgres.query("insert into app.accounts(user_id,account_id,provider_id,password) values($1::uuid,$1::text,'credential',$2)", [userId, await hashPassword(password)]);
const venues = [];
const flowFixtures = [];
for (const [name, slug, plan] of [["Smash Arena Demo", "smash-arena-demo", "PRO"], ["Starter Arena Demo", "starter-arena-demo", "STARTER"],
  ["Professional Arena Demo", "professional-arena-demo", "PROFESSIONAL"], ["Business Arena Demo", "business-arena-demo", "BUSINESS"]]) {
  const organizationId = randomUUID(), branchId = randomUUID();
  await postgres.query(`insert into app.organizations(id,name,display_name,slug,plan_code,contact_email,contact_phone,city,state,onboarding_completed_at)
    values($1,$2,$2,$3,$4,'venue@example.test','+60312345678','Petaling Jaya','Selangor',now())`, [organizationId, name, slug, plan]);
  await postgres.query("insert into app.organization_members(organization_id,user_id,role) values($1,$2,'OWNER')", [organizationId, userId]);
  await postgres.query(`insert into app.organization_subscriptions(organization_id,plan_code,status,provider,billing_cycle,current_period_start,current_period_end)
    values($1,$2,'ACTIVE','LEGACY','MONTHLY',now(),now()+interval '30 days')`, [organizationId, plan]);
  await postgres.query("insert into app.branches(id,organization_id,name,slug,city,state) values($1,$2,'Main Venue','main-venue','Petaling Jaya','Selangor')", [branchId, organizationId]);
  for (const [code, amount] of [["BADMINTON", 2500], ["PICKLEBALL", 3000]]) {
    const sport = (await postgres.query("select id,name from app.sport_types where code=$1", [code])).rows[0];
    await postgres.query("insert into app.organization_sports(organization_id,sport_type_id) values($1,$2)", [organizationId, sport.id]);
    await postgres.query("insert into app.base_prices(organization_id,branch_id,sport_type_id,amount_minor,duration_minutes) values($1,$2,$3,$4,60)", [organizationId, branchId, sport.id, amount]);
    for (let number = 1; number <= 2; number++) await postgres.query(`insert into app.resources(organization_id,branch_id,sport_type_id,name,display_type,
      minimum_duration_minutes,maximum_duration_minutes,booking_interval_minutes) values($1,$2,$3,$4,'COURT',60,180,60)`, [organizationId, branchId, sport.id, `${sport.name} Court ${number}`]);
  }
  for (let day = 0; day < 7; day++) await postgres.query("insert into app.operating_hours(organization_id,branch_id,day_of_week,start_minute,end_minute) values($1,$2,$3,480,1440)", [organizationId, branchId, day]);
  venues.push({ slug, organizationId, plan });
  if (plan === "PRO") {
    const badminton = (await postgres.query("select id from app.sport_types where code='BADMINTON'")).rows[0];
    for (let number = 3; number <= 14; number++) await postgres.query(`insert into app.resources(organization_id,branch_id,sport_type_id,name,display_type,
      minimum_duration_minutes,maximum_duration_minutes,booking_interval_minutes) values($1,$2,$3,$4,'COURT',60,180,60)`,
    [organizationId, branchId, badminton.id, `Badminton Court ${number}`]);
    const secondBranchId = randomUUID();
    await postgres.query("insert into app.branches(id,organization_id,name,slug,timezone) values($1,$2,'Second Venue','second-venue','Asia/Tokyo')", [secondBranchId, organizationId]);
    await postgres.query("insert into app.base_prices(organization_id,branch_id,sport_type_id,amount_minor,duration_minutes) values($1,$2,$3,4500,60)", [organizationId, secondBranchId, badminton.id]);
    await postgres.query(`insert into app.resources(organization_id,branch_id,sport_type_id,name,display_type,
      minimum_duration_minutes,maximum_duration_minutes,booking_interval_minutes) values($1,$2,$3,'Second Venue Court','COURT',60,180,60)`,
    [organizationId, secondBranchId, badminton.id]);
    for (let day = 0; day < 7; day++) await postgres.query("insert into app.operating_hours(organization_id,branch_id,day_of_week,start_minute,end_minute) values($1,$2,$3,480,1440)", [organizationId, secondBranchId, day]);
  }
  if (plan === "STARTER") {
    const space = (await postgres.query("select id from app.resources where organization_id=$1 and name='Badminton Court 1'", [organizationId])).rows[0];
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(Date.now() + 86_400_000));
    const customerId = randomUUID(), bookingId = randomUUID(), paymentId = randomUUID();
    await postgres.query("insert into app.customers(id,organization_id,name,phone,email) values($1,$2,'Refund Flow Guest','+601199999999','refund.guest@example.test')", [customerId, organizationId]);
    for (const [id, reference, hour, paid] of [[bookingId, "BK-FLOW-AUDIT", 8, 2500], [randomUUID(), "BK-OCCUPIED-AUDIT", 9, 0]]) {
      const startAt = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`);
      await postgres.query(`insert into app.bookings(id,organization_id,branch_id,resource_id,customer_id,booking_reference,start_at,end_at,status,source,subtotal,total_amount,amount_paid,currency,created_by_user_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,'CONFIRMED','STAFF',2500,2500,$9,'MYR',$10)`,
      [id, organizationId, branchId, space.id, customerId, reference, startAt, new Date(startAt.getTime() + 3_600_000), paid, userId]);
    }
    await postgres.query(`insert into app.payments(id,organization_id,booking_id,provider,idempotency_key,amount_minor,currency,status,payment_method,type,paid_at,recorded_by_user_id)
      values($1,$2,$3,'MANUAL',$4,2500,'MYR','PAID','CASH','MANUAL_PAYMENT',now(),$5)`, [paymentId, organizationId, bookingId, randomUUID(), userId]);
    flowFixtures.push({ organizationId, bookingId, paymentId, date, reference: "BK-FLOW-AUDIT" });
  }
}

const fixtureDirectory = resolve(".billing-verification");
mkdirSync(fixtureDirectory, { recursive: true });
// Build artifacts belong to a disposable app directory so browser verification
// can never corrupt a simultaneous production build's .next output.
const appDirectory = resolve(fixtureDirectory, `app-${randomUUID()}`);
mkdirSync(appDirectory, { recursive: true });
// Next's route watcher needs physical source files; junctions here can resolve
// outside its application root and produce only the not-found route.
for (const directory of ["src", "public"]) cpSync(resolve(directory), resolve(appDirectory, directory), { recursive: true });
symlinkSync(resolve("node_modules"), resolve(appDirectory, "node_modules"), process.platform === "win32" ? "junction" : "dir");
for (const file of ["package.json", "tsconfig.json", "postcss.config.mjs"])
  copyFileSync(resolve(file), resolve(appDirectory, file));
// A direct local driver avoids socket-protocol limitations. Only the disposable
// source copy uses this module; application production code is untouched.
const snapshotPath = resolve(fixtureDirectory, "database.tar");
writeFileSync(snapshotPath, Buffer.from(await (await postgres.dumpDataDir("none")).arrayBuffer()));
await postgres.close();
const driverPath = resolve(appDirectory, "fixture-db.ts");
writeFileSync(driverPath, `import "server-only";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
const state = globalThis as typeof globalThis & { __slotraFixture?: ReturnType<typeof drizzle<typeof schema>> };
export function getDb() {
  if (!state.__slotraFixture) {
    const client = new PGlite({ extensions: { btree_gist }, loadDataDir: new Blob([new Uint8Array(readFileSync(${JSON.stringify(snapshotPath)}))]) });
    state.__slotraFixture = drizzle({ client, schema });
  }
  return state.__slotraFixture;
}
`);
copyFileSync(driverPath, resolve(appDirectory, "src/db/client.ts"));
writeFileSync(resolve(appDirectory, "next.config.ts"), readFileSync(resolve("next.config.ts"), "utf8").replace("export default nextConfig;", `
nextConfig.serverExternalPackages = [...(nextConfig.serverExternalPackages ?? []), "@electric-sql/pglite"];
export default nextConfig;
`));
writeFileSync(resolve(fixtureDirectory, "e2e-credentials.json"), JSON.stringify({ email, password, venues, flowFixtures, appDirectory }), { mode: 0o600 });
const origin = "http://127.0.0.1:3018";
const safeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "COMSPEC", "PATHEXT"].includes(key.toUpperCase())));
const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3018"], {
  cwd: appDirectory, stdio: "inherit", windowsHide: true,
  env: { ...safeEnvironment, NODE_ENV: "development", DEPLOYMENT_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: `postgresql://postgres:${randomBytes(24).toString("hex")}@127.0.0.1:55418/postgres`,
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), BETTER_AUTH_URL: origin,
    NEXT_PUBLIC_APP_URL: origin, NEXT_PUBLIC_BOOKING_URL: origin, NEXT_PUBLIC_MARKETING_URL: origin,
    ENABLE_SCHEDULED_JOBS: "false", ENABLE_TEST_PAYMENTS: "false", ENABLE_TOYYIBPAY_SANDBOX: "false", ENABLE_DEV_SUBSCRIPTIONS: "false" },
});
console.log("Disposable fixture created. Browser URL: http://127.0.0.1:3018. Optional providers are absent; no remote database is used.");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill();
}
process.on("SIGINT", () => { void stop().finally(() => process.exit(0)); });
process.on("SIGTERM", () => { void stop().finally(() => process.exit(0)); });
child.on("exit", code => { void stop().finally(() => process.exit(code ?? 0)); });
