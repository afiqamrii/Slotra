"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/authorization";
import { revokeSession, revokeOtherSessions, revokeAllSessions } from "@/lib/session-service";

export async function revokeSessionAction(form: FormData) {
  const { user, session } = await requireUser();
  const parsed = z.uuid().safeParse(form.get("sessionId"));
  if (!parsed.success) return;
  await revokeSession(getDb(), user.id, session.id, parsed.data);
  redirect("/account/security");
}

export async function revokeOtherSessionsAction() {
  const { user, session } = await requireUser();
  await revokeOtherSessions(getDb(), user.id, session.id);
  redirect("/account/security");
}

export async function logoutAllSessionsAction() {
  const { user } = await requireUser();
  await revokeAllSessions(getDb(), user.id);
  redirect("/login");
}
