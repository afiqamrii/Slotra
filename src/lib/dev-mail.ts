import "server-only";
import { isDevelopmentRuntime } from "@/lib/deployment-environment";
import { deliverAccountEmail, validateAccountLink, type AccountMessage } from "@/lib/account-email";

type DevMessage = AccountMessage;
const store = globalThis as typeof globalThis & { __slotraDevMessages?: DevMessage[] };
const messages = store.__slotraDevMessages ??= [];

export async function deliverAuthLink(message: DevMessage) {
  if (!isDevelopmentRuntime() || process.env.NODE_ENV !== "development") {
    await deliverAccountEmail(message);
    return;
  }
  validateAccountLink(message);
  messages.unshift(message);
  messages.length = Math.min(messages.length, 30);
}

export function getDevelopmentMessages() {
  if (!isDevelopmentRuntime() || process.env.NODE_ENV !== "development") return [];
  return messages;
}
