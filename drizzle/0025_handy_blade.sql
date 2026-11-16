ALTER TABLE "app"."organizations" ADD COLUMN "cancellation_policy" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "refund_policy" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "venue_rules" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_public_policies_ck" CHECK (("app"."organizations"."cancellation_policy" is null or char_length("app"."organizations"."cancellation_policy") <= 5000)
    and ("app"."organizations"."refund_policy" is null or char_length("app"."organizations"."refund_policy") <= 5000)
    and ("app"."organizations"."venue_rules" is null or char_length("app"."organizations"."venue_rules") <= 5000));