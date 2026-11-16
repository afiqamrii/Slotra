"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { scheduleSubscriptionChange, setSubscriptionCancellation, simulateSubscriptionClock, simulateSubscriptionEvent, startSubscriptionCheckout } from "@/lib/subscription-service";

export async function changeBillingAction(form: FormData) {
  const { organization, session } = await requireOrganizationMember();
  const action = String(form.get("action") ?? "");
  let destination = "/settings/billing?updated=1";
  try {
    const db = getDb(), orgId = organization.organizationId, actorId = session.user.id;
    if (action === "SUBSCRIBE") {
      const result = await startSubscriptionCheckout(db, actorId, orgId, { plan: form.get("plan"), cycle: form.get("cycle") });
      destination = result.url;
    } else if (action === "SCHEDULE") {
      await scheduleSubscriptionChange(db, actorId, orgId, { plan: form.get("plan"), cycle: form.get("cycle") });
    } else if (action === "CANCEL" || action === "RESUME") {
      if (form.get("confirm") !== "yes") throw new Error("Confirmation required.");
      await setSubscriptionCancellation(db, actorId, orgId, action === "CANCEL");
    } else if (["START_TRIAL", "RENEWAL_DUE", "EXPIRE_TRIAL", "EXPIRE_GRACE"].includes(action)) {
      await simulateSubscriptionClock(db, actorId, orgId, action as "START_TRIAL" | "RENEWAL_DUE" | "EXPIRE_TRIAL" | "EXPIRE_GRACE");
    } else if (["SUCCESS", "FAIL_CHECKOUT", "RENEWAL", "FAILED_RENEWAL"].includes(action)) {
      await simulateSubscriptionEvent(db, actorId, orgId, action as "SUCCESS" | "FAIL_CHECKOUT" | "RENEWAL" | "FAILED_RENEWAL",
        form.get("checkoutId") ? String(form.get("checkoutId")) : undefined);
    } else throw new Error("Invalid billing action.");
  } catch {
    destination = "/settings/billing?error=change";
  }
  revalidatePath("/", "layout");
  redirect(destination);
}
