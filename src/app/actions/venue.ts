"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { postgresErrorCode } from "@/lib/auth";
import { changeResourceStatus, completeSetup, createResource, slugAvailable, slugSchema, updateBranch, updateResource } from "@/lib/venue-service";

export async function checkSlugAction(value: string) {
  const context = await requirePermission("organization:update");
  const parsed = slugSchema.safeParse(value);
  if (!parsed.success) return { available: false, message: parsed.error.issues[0]?.message ?? "Invalid address" };
  const available = await slugAvailable(getDb(), parsed.data, context.organization.organizationId);
  return { available, message: available ? "Available" : "Already taken" };
}
export async function finishSetupAction(raw: unknown) {
  const context = await requirePermission("organization:update");
  try {
    await completeSetup(getDb(), context.session.user.id, context.organization.organizationId, raw);
    revalidatePath("/dashboard");
    return { error: null };
  } catch (error) {
    if (postgresErrorCode(error) === "23505") return { error: "A space name or booking page address is already taken." };
    return { error: error instanceof Error ? error.message : "Could not finish setup." };
  }
}
export async function saveBranchAction(raw: unknown) {
  const context = await requirePermission("branch:manage");
  const branchId = String((raw as { id?: string })?.id ?? "");
  try {
    await updateBranch(getDb(), context.session.user.id, context.organization.organizationId, branchId, raw);
    revalidatePath("/settings/branch");
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not save branch" }; }
}
export async function saveResourceAction(id: string | null, raw: unknown) {
  const context = await requirePermission("resource:manage");
  try {
    if (id) await updateResource(getDb(), context.session.user.id, context.organization.organizationId, id, raw);
    else await createResource(getDb(), context.session.user.id, context.organization.organizationId, raw);
    revalidatePath("/courts-and-spaces");
    return { error: null };
  } catch (error) {
    if (postgresErrorCode(error) === "23505") return { error: "A space with that name already exists at this branch." };
    return { error: error instanceof Error ? error.message : "Could not save space" };
  }
}
export async function resourceStatusAction(id: string, status: string) {
  const context = await requirePermission("resource:manage");
  try {
    await changeResourceStatus(getDb(), context.session.user.id, context.organization.organizationId, id, status);
    revalidatePath("/courts-and-spaces");
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not change status" }; }
}

