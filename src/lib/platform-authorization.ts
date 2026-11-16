import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/authorization";
import { requireSuperAdmin } from "@/lib/super-admin-service";

// Guard both layout and page: parallel server rendering must not throw a raw access error.
export const requirePlatformAdministrator = cache(async function requirePlatformAdministrator() {
  const session = await requireUser();
  try { await requireSuperAdmin(getDb(), session.user.id); } catch { notFound(); }
  return session;
});
