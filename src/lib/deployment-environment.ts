// Pure deployment policy shared by adapters, scripts and configuration checks.
export type Environment = Record<string, string | undefined>;
export type DeploymentEnvironment = "development" | "staging" | "production";

export function isPreviewEnvironment(env: Environment = process.env) {
  return env.VERCEL_ENV === "preview";
}

export function deploymentEnvironment(env: Environment = process.env): DeploymentEnvironment {
  if (isPreviewEnvironment(env)) return "staging";
  if (env.VERCEL_ENV === "production") return env.DEPLOYMENT_ENV === "staging" ? "staging" : "production";
  if (env.DEPLOYMENT_ENV === "staging" || env.DEPLOYMENT_ENV === "production") return env.DEPLOYMENT_ENV;
  return env.NODE_ENV === "production" ? "production" : "development";
}

export function isDevelopmentRuntime(env: Environment = process.env) {
  return deploymentEnvironment(env) === "development" && env.NODE_ENV !== "production" && !env.VERCEL;
}

export function recipientAllowed(email: string, env: Environment = process.env) {
  if (deploymentEnvironment(env) !== "staging") return true;
  const allowed = (env.STAGING_EMAIL_ALLOWLIST ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
