import { toNextJsHandler } from "better-auth/next-js";
import { getAuth, getAuthConfigurationIssue, postgresErrorCode } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configurationResponse() {
  const issue = getAuthConfigurationIssue();
  return issue ? Response.json({
    message: process.env.NODE_ENV === "development" ? issue : "Account access is temporarily unavailable.",
  }, { status: 503 }) : null;
}

export async function GET(request: Request) {
  const issue = configurationResponse();
  if (issue) return issue;
  try {
    return await toNextJsHandler(await getAuth()).GET(request);
  } catch (error) {
    if (process.env.NODE_ENV === "development" && postgresErrorCode(error) === "28P01") {
      return Response.json({ message: "Supabase rejected the database password in .env.local." }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const issue = configurationResponse();
  if (issue) return issue;
  // Email delivery has no production provider. Block signup and reset before
  // Better Auth can create an account or issue a token.
  if (process.env.NODE_ENV === "production" &&
    /^\/(sign-up\/email|forget-password|request-password-reset|send-verification-email)$/.test(new URL(request.url).pathname.replace(/^\/api\/auth/, ""))) {
    return Response.json({ message: "Email delivery is not configured." }, { status: 503 });
  }
  try {
    return await toNextJsHandler(await getAuth()).POST(request);
  } catch (error) {
    if (process.env.NODE_ENV === "development" && postgresErrorCode(error) === "28P01") {
      return Response.json({ message: "Supabase rejected the database password in .env.local." }, { status: 503 });
    }
    throw error;
  }
}

