import { Check } from "lucide-react";

export function OnboardingProgress({ activeStep, finalStep = "Business" }: {
  activeStep: 1 | 2 | 3;
  finalStep?: string;
}) {
  const steps = ["Account", "Verify email", finalStep];
  return <ol aria-label="Setup progress" className="onboarding-progress">
    {steps.map((label, index) => {
      const step = index + 1;
      const complete = step < activeStep;
      return <li aria-current={step === activeStep ? "step" : undefined}
        className={"onboarding-step" + (complete ? " onboarding-step-complete" : "") + (step === activeStep ? " onboarding-step-current" : "")}
        key={label}>
        <span aria-hidden="true" className="onboarding-step-marker">{complete ? <Check size={13} /> : step}</span>
        <span>{label}</span>
      </li>;
    })}
  </ol>;
}
