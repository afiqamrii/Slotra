import "server-only";
import { z } from "zod";
export function supportEmail() {
  const email = z.email().safeParse(process.env.SUPPORT_EMAIL);
  return email.success ? email.data : null;
}
