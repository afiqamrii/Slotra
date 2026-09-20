import "server-only";

type DevMessage = { to: string; kind: "verification" | "password reset"; url: string; createdAt: Date };
const store = globalThis as typeof globalThis & { __slotraDevMessages?: DevMessage[] };
const messages = store.__slotraDevMessages ??= [];

export async function deliverAuthLink(message: DevMessage) {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Email delivery is not configured. Set up a provider before accepting production accounts.");
  }
  messages.unshift(message);
  messages.length = Math.min(messages.length, 30);
}

export function getDevelopmentMessages() {
  if (process.env.NODE_ENV !== "development") return [];
  return messages;
}
