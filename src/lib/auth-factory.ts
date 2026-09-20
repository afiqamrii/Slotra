import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { brand } from "@/lib/brand";

type AuthOptions = {
  baseURL: string;
  secret: string;
  deliver: (message: { to: string; kind: "verification" | "password reset"; url: string; createdAt: Date }) => Promise<void>;
};

// The adapter accepts PostgreSQL drivers sharing this generic Drizzle interface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAuth(database: PgDatabase<any, any, any>, { baseURL, secret, deliver }: AuthOptions) {
  return betterAuth({
    appName: brand.name,
    baseURL,
    secret,
    database: drizzleAdapter(database, {
      provider: "pg",
      schemaName: "app",
      schema,
    }),
    user: { modelName: "users" },
    session: { modelName: "sessions", expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" },
    },
    rateLimit: { enabled: true, storage: "database", modelName: "rateLimits" },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await deliver({ to: user.email, kind: "password reset", url, createdAt: new Date() });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await deliver({ to: user.email, kind: "verification", url, createdAt: new Date() });
      },
    },
  });
}


