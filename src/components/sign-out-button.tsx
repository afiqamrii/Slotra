"use client";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
export function SignOutButton() {
  const router = useRouter();
  return <button className="text-button" type="button" onClick={async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }}>Sign out</button>;
}
