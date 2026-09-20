"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireOrganizationMember, requireUser, setCurrentOrganization } from "@/lib/authorization";
import { createOrganization, organizationInput, selectOrganization } from "@/lib/organization-service";
import { postgresErrorCode } from "@/lib/auth";

export type OrganizationSetupState = { error: string | null };

export async function createOrganizationAction(
  _previous: OrganizationSetupState,
  form: FormData,
): Promise<OrganizationSetupState> {
  const session = await requireUser();
  const input = organizationInput.safeParse({ name: form.get("name"), slug: form.get("slug") });
  if (!input.success) return { error: "Enter a business name and a valid workspace address." };
  try {
    const organization = await createOrganization(getDb(), session.user.id, input.data);
    await setCurrentOrganization(organization.id);
  } catch (error) {
    if (postgresErrorCode(error) === "23505") {
      return { error: "That workspace address is already taken. Please choose another." };
    }
    return { error: "We could not create the workspace. Please try again." };
  }
  redirect("/onboarding");
}

export async function switchOrganizationAction(form: FormData) {
  const { session } = await requireOrganizationMember();
  const organizationId = String(form.get("organizationId") ?? "");
  await selectOrganization(getDb(), session.user.id, organizationId);
  await setCurrentOrganization(organizationId);
  redirect("/dashboard");
}


