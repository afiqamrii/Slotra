"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectTestProviderAction, disconnectTestProviderAction, connectToyyibSandboxAction, disconnectToyyibSandboxAction, savePaymentSettingsAction } from "@/app/actions/payments";
import type { PaymentPolicy } from "@/lib/payment-policy";

const choices = [
  { value: "NO_UPFRONT", title: "Pay at venue", copy: "Confirm now. Collect the balance at the counter." },
  { value: "FULL", title: "Full payment", copy: "Collect the entire booking price before confirming." },
  { value: "FIXED_DEPOSIT", title: "Fixed deposit", copy: "Collect a set amount now; the rest is due later." },
  { value: "PERCENT_DEPOSIT", title: "Percentage deposit", copy: "Collect a percentage now; the rest is due later." },
] as const;

export function PaymentSettingsForm({ initial, connectedProvider, canEdit, testAvailable, sandboxAvailable, currency }: {
  initial: PaymentPolicy; connectedProvider: string | null; canEdit: boolean; testAvailable: boolean;
  sandboxAvailable: boolean; currency: string;
}) {
  const connected = !!connectedProvider;
  const router = useRouter();
  const [policy, setPolicy] = useState(initial);
  const [fixed, setFixed] = useState(initial.fixedDepositMinor ? String(initial.fixedDepositMinor / 100) : "");
  const [percent, setPercent] = useState(initial.depositPercentage ? String(initial.depositPercentage) : "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<{ error: string | null }>) {
    setError(null); setSaved(false);
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      if (!result.error) { setSaved(true); router.refresh(); }
    });
  }
  return <div className="payment-settings-layout">
    <section className="foundation-card payment-settings-main">
      <p className="eyebrow">CHECKOUT POLICY</p><h2>How should guests pay?</h2>
      <p>Choose the online amount, then allow Pay at venue too if you want guests to choose. Existing bookings keep their original terms.</p>
      <div className="payment-policy-options">{choices.map(choice =>
        <label key={choice.value} className={policy.requirement === choice.value ? "payment-policy-choice selected" : "payment-policy-choice"}>
          <input type="radio" name="payment-requirement" value={choice.value}
            disabled={!canEdit || (choice.value !== "NO_UPFRONT" && !connected)}
            checked={policy.requirement === choice.value}
            onChange={() => { setPolicy({ ...policy, requirement: choice.value }); setSaved(false); }} />
          <span><strong>{choice.title}</strong><small>{choice.copy}</small></span>
        </label>)}</div>
      {!connected && <p className="payment-inline-note">Online deposits and full payment need a connected provider. Sandbox options below are for testing only and do not move real money.</p>}
      {policy.requirement === "FIXED_DEPOSIT" && <label className="venue-field">Deposit amount ({currency})
        <input type="number" min="0.01" step="0.01" value={fixed} disabled={!canEdit}
          onChange={event => setFixed(event.target.value)} placeholder="20.00" /></label>}
      {policy.requirement === "PERCENT_DEPOSIT" && <label className="venue-field">Deposit percentage
        <input type="number" min="1" max="100" step="1" value={percent} disabled={!canEdit}
          onChange={event => setPercent(event.target.value)} placeholder="30" /></label>}
      <label className="payment-toggle"><input type="checkbox" checked={policy.manualEnabled} disabled={!canEdit}
        onChange={event => setPolicy({ ...policy, manualEnabled: event.target.checked })} />
        <span><strong>Offer Pay at venue</strong><small>When a test checkout is enabled, guests can choose either option. Staff can record cash, bank transfer, or other manual payments after receipt.</small></span></label>
      <details className="payment-advanced"><summary>Checkout hold length</summary>
        <label className="venue-field">Minutes before an unpaid checkout expires
          <input type="number" min="5" max="30" value={policy.holdMinutes} disabled={!canEdit}
            onChange={event => setPolicy({ ...policy, holdMinutes: Number(event.target.value) })} /></label></details>
      {error && <p className="public-error" role="alert">{error}</p>}
      {saved && <p className="payment-success" role="status">Payment settings saved.</p>}
      {canEdit && <button className="button button-primary" type="button" disabled={pending}
        onClick={() => run(() => savePaymentSettingsAction({
          ...policy, fixedDepositMinor: fixed ? Math.round(Number(fixed) * 100) : null,
          depositPercentage: percent ? Number(percent) : null,
        }))}>{pending ? "Saving…" : "Save payment settings"}</button>}
    </section>
    <aside className="foundation-card payment-provider-card">
      <p className="eyebrow">ONLINE PAYMENTS · AVAILABLE WITH YOUR PLAN</p><h2>Connect a payment provider</h2>
      <p>For live payments, customer funds must go directly to each venue merchant account. Sandbox payments below move no real money.</p>
      {connectedProvider === "TOYYIBPAY_SANDBOX" ?
        <div className="payment-provider-status"><strong>ToyyibPay sandbox connected</strong><small>Test-bank checkout only. No real funds move. The shared test merchant account moves no real money.</small></div> :
        connectedProvider === "TEST" ?
          <div className="payment-provider-status"><strong>TestProvider connected</strong><small>Local simulation only — no real money moves.</small></div> :
          <div className="payment-provider-status"><strong>No live online provider connected</strong><small>Connect a payment provider to accept online payments. Until then, guests can pay at the venue. Only sandbox/test connections are currently supported.</small></div>}
      {sandboxAvailable && canEdit && <button type="button" disabled={pending} className="button button-secondary"
        onClick={() => run(connectedProvider === "TOYYIBPAY_SANDBOX" ? disconnectToyyibSandboxAction : connectToyyibSandboxAction)}>
        {connectedProvider === "TOYYIBPAY_SANDBOX" ? "Disconnect ToyyibPay sandbox" : "Connect ToyyibPay sandbox"}</button>}
      {testAvailable && canEdit && <button type="button" disabled={pending} className="button button-secondary"
        onClick={() => run(connectedProvider === "TEST" ? disconnectTestProviderAction : connectTestProviderAction)}>
        {connectedProvider === "TEST" ? "Disconnect test provider" : "Use local test provider"}</button>}
      {!sandboxAvailable && !testAvailable && <p className="payment-inline-note">Online checkout is not configured for this venue. No pretend connection or charge is offered.</p>}
      {sandboxAvailable && <p className="payment-inline-note">This shared sandbox account is for testing across venues only. Before live use, each venue needs its own merchant account and a separate production integration.</p>}    </aside>
  </div>;
}

