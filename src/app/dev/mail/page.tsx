import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getDevelopmentMessages } from "@/lib/dev-mail";

export const dynamic = "force-dynamic";

export default async function DevelopmentMailPage() {
  if (process.env.NODE_ENV !== "development" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test((await headers()).get("host") ?? "")) notFound();
  const messages = getDevelopmentMessages();
  return <main className="dev-mail-page" id="main-content">
    <h1>Development mail</h1>
    <p>No email was sent. These links are held in this local development process and disappear when it restarts.</p>
    {messages.length ? <ul>{messages.map((message, index) => <li key={`${message.createdAt.toISOString()}-${index}`}>
      <strong>{message.kind}</strong> for {message.to} · <Link href={message.url}>Open link</Link>
    </li>)}</ul> : <p>No verification or reset links yet.</p>}
    <Link href="/login">Back to sign in</Link>
  </main>;
}
