"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { OnboardingProgress } from "@/components/onboarding-progress";
import { brand } from "@/lib/brand";
import { authClient } from "@/lib/auth-client";

type Mode = "login" | "register" | "forgot" | "reset";
const copy: Record<Mode, { eyebrow: string; title: string; description: string; button: string }> = {
  login: { eyebrow: "YOUR WORKSPACE", title: "Welcome back", description: "Sign in to manage your venue.", button: "Sign in" },
  register: { eyebrow: "GET STARTED", title: "Create your account", description: "Set up your organization after verifying your email.", button: "Create account" },
  forgot: { eyebrow: "ACCOUNT RECOVERY", title: "Reset your password", description: "We’ll send a reset link to your email address.", button: "Send reset link" },
  reset: { eyebrow: "ACCOUNT RECOVERY", title: "Choose a new password", description: "Use at least 12 characters for your new password.", button: "Update password" },
};

export function AuthPage({ mode, token = "", nextPath = "/dashboard", configured = true, configurationIssue }: {
  mode: Mode; token?: string; nextPath?: string; configured?: boolean; configurationIssue?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const item = copy[mode];
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard";
  const needsConfirmation = mode === "register" || mode === "reset";
  const passwordIsLongEnough = password.length >= 12;
  const passwordsMatch = confirmation.length > 0 && confirmation === password;
  const hasVariety = /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    try {
      if (needsConfirmation && (password.length < 12 || password !== String(values.get("confirmation") ?? ""))) {
        throw new Error("Use at least 12 characters and make sure both passwords match.");
      }
      if (mode === "register") {
        const result = await authClient.signUp.email({
          name: String(values.get("name") ?? "").trim(), email, password,
          callbackURL: "/login?verified=1&next=" + encodeURIComponent(safeNext),
        });
        if (result.error) throw new Error(result.error.message);
        setRegistrationComplete(true);
        setMessage("Account created. Open the verification link sent to your email. In local development, find it at /dev/mail.");
      } else if (mode === "login") {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) throw new Error(result.error.message);
        router.push(safeNext);
        router.refresh();
      } else if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
        if (result.error) throw new Error(result.error.message);
        setMessage("If this account exists, a reset link is available through the configured email delivery.");
      } else {
        const result = await authClient.resetPassword({ token, newPassword: password });
        if (result.error) throw new Error(result.error.message);
        router.push("/login?reset=1");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header"><BrandLogo /><Link className="auth-back" href="/"><ArrowLeft aria-hidden="true" size={16} /> Back to home</Link></header>
      <main className="auth-main" id="main-content">
        <div className="auth-layout">
          <aside className="auth-visual" aria-label="A little more time for the game">
            <Image alt="" className="auth-photo" fill priority sizes="(max-width: 800px) 100vw, 50vw" src="/images/venue-court.webp" />
            <div className="auth-visual-copy">
              <p className="eyebrow">MORE ROOM FOR THE GAME</p>
              <h2>Good days start<br />with a clear view.</h2>
              <p>Bring your bookings, spaces and team together. Make more time for the people who come to play.</p>
            </div>
          </aside>
          <div className="auth-form-panel"><div className="auth-card">
            <span aria-hidden="true" className="auth-icon"><LockKeyhole size={23} strokeWidth={1.7} /></span>
            {mode === "register" && <OnboardingProgress activeStep={registrationComplete ? 2 : 1} finalStep={safeNext.startsWith("/invitations/") ? "Join team" : "Business"} />}
            <p className="eyebrow">{item.eyebrow}</p><h1>{item.title}</h1>
            <p className="auth-description">{item.description}</p>
            {!configured && <p className="form-alert" role="alert">{configurationIssue ?? "Account access needs server configuration."}</p>}
            <form aria-label={item.title} className="auth-form" onSubmit={submit}>
              {mode === "register" && <div className="field"><label htmlFor="name">Your name</label><input autoComplete="name" id="name" name="name" required minLength={2} maxLength={120} placeholder="Your name" /></div>}
              {mode !== "reset" && <div className="field"><label htmlFor="email">Email address</label><input autoComplete="email" id="email" name="email" required type="email" placeholder="you@venue.com" /></div>}
              {(mode === "login" || mode === "register" || mode === "reset") && <div className="field"><label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</label><div className="password-input"><input autoComplete={mode === "login" ? "current-password" : "new-password"} id="password" name="password" required minLength={mode === "login" ? undefined : 12} type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "login" ? "Enter your password" : "At least 12 characters"} /><button aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="password-toggle" onClick={() => setShowPassword(!showPassword)} type="button">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>}
              {needsConfirmation && <>
                <div className="password-guidance" aria-live="polite">
                  <p className={passwordIsLongEnough ? "password-rule met" : "password-rule"}><Check aria-hidden="true" size={14} /> At least 12 characters</p>
                  <p className={hasVariety ? "password-rule met" : "password-rule"}><Check aria-hidden="true" size={14} /> Recommended: mix uppercase, lowercase and numbers</p>
                </div>
                <div className="field"><label htmlFor="confirmation">Confirm password</label><div className="password-input"><input autoComplete="new-password" id="confirmation" name="confirmation" required minLength={12} type={showConfirmation ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Enter it again" /><button aria-label={showConfirmation ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={showConfirmation} className="password-toggle" onClick={() => setShowConfirmation(!showConfirmation)} type="button">{showConfirmation ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{confirmation && <small className={passwordsMatch ? "password-match met" : "password-match"} aria-live="polite">{passwordsMatch ? "Passwords match" : "Passwords do not match yet"}</small>}</div>
              </>}
              {mode === "reset" && !token && <p className="form-alert">This reset link is missing its token. Request a new one.</p>}
              {error && <p className="form-alert" role="alert">{error}</p>}
              {message && <p className="form-success" role="status">{message} {process.env.NODE_ENV === "development" && <Link href="/dev/mail">Open local mail</Link>}</p>}
              <button className="button button-primary auth-submit" disabled={!configured || pending || (mode === "reset" && !token) || (needsConfirmation && (!passwordIsLongEnough || !passwordsMatch)) || (mode === "register" && registrationComplete)} type="submit">{pending ? "Please wait…" : item.button}</button>
            </form>
            {mode === "login" && <p className="auth-link-row"><Link href="/forgot-password">Forgot password?</Link></p>}
            <p className="auth-switch">{mode === "login" ? "New to the workspace?" : "Already have an account?"} <Link href={mode === "login" ? "/register?next=" + encodeURIComponent(safeNext) : "/login?next=" + encodeURIComponent(safeNext)}>{mode === "login" ? "Create an account" : "Sign in"}</Link></p>
          </div></div>
        </div>
      </main>
      <footer className="auth-footer">A product by {brand.company}</footer>
    </div>
  );
}

