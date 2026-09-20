import { z } from "zod";
import type { PaymentRequirement } from "@/db/schema";

export const paymentSettingsInput = z.object({
  requirement: z.enum(["NO_UPFRONT", "FULL", "FIXED_DEPOSIT", "PERCENT_DEPOSIT"]),
  fixedDepositMinor: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  depositPercentage: z.number().int().min(1).max(100).nullable().optional(),
  manualEnabled: z.boolean(),
  holdMinutes: z.number().int().min(5).max(30).default(10),
}).superRefine((value, context) => {
  if (value.requirement === "NO_UPFRONT" && !value.manualEnabled)
    context.addIssue({ code: "custom", message: "Enable pay at venue when no upfront payment is required", path: ["manualEnabled"] });
  if (value.requirement === "FIXED_DEPOSIT" && !value.fixedDepositMinor)
    context.addIssue({ code: "custom", message: "Enter a fixed deposit amount", path: ["fixedDepositMinor"] });
  if (value.requirement === "PERCENT_DEPOSIT" && !value.depositPercentage)
    context.addIssue({ code: "custom", message: "Enter a deposit percentage", path: ["depositPercentage"] });
});

export type PaymentPolicy = {
  requirement: PaymentRequirement;
  fixedDepositMinor: number | null;
  depositPercentage: number | null;
  manualEnabled: boolean;
  holdMinutes: number;
};
export const defaultPaymentPolicy: PaymentPolicy = {
  requirement: "NO_UPFRONT", fixedDepositMinor: null, depositPercentage: null,
  manualEnabled: true, holdMinutes: 10,
};

export function paymentDue(totalMinor: number, policy: PaymentPolicy) {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new Error("Invalid booking total");
  let requiredNowMinor = 0;
  switch (policy.requirement) {
    case "FULL": requiredNowMinor = totalMinor; break;
    case "FIXED_DEPOSIT": requiredNowMinor = Math.min(totalMinor, policy.fixedDepositMinor ?? 0); break;
    case "PERCENT_DEPOSIT": requiredNowMinor = Math.min(totalMinor, Math.round(totalMinor * (policy.depositPercentage ?? 0) / 100)); break;
  }
  return { requiredNowMinor, remainingMinor: totalMinor - requiredNowMinor };
}

export function testPaymentsEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_TEST_PAYMENTS === "true";
}


