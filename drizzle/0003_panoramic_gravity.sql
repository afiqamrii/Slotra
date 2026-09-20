CREATE TABLE "app"."base_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sport_type_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_prices_amount_ck" CHECK ("app"."base_prices"."amount_minor" >= 0 and "app"."base_prices"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."organization_sports" (
	"organization_id" uuid NOT NULL,
	"sport_type_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "address_line_1" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "address_line_2" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "postcode" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "country" varchar(2) DEFAULT 'MY' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."base_prices" ADD CONSTRAINT "base_prices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."base_prices" ADD CONSTRAINT "base_prices_sport_type_id_sport_types_id_fk" FOREIGN KEY ("sport_type_id") REFERENCES "app"."sport_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."base_prices" ADD CONSTRAINT "base_prices_org_branch_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "app"."branches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_sports" ADD CONSTRAINT "organization_sports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_sports" ADD CONSTRAINT "organization_sports_sport_type_id_sport_types_id_fk" FOREIGN KEY ("sport_type_id") REFERENCES "app"."sport_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "base_prices_org_branch_sport_uq" ON "app"."base_prices" USING btree ("organization_id","branch_id","sport_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_sports_org_sport_uq" ON "app"."organization_sports" USING btree ("organization_id","sport_type_id");--> statement-breakpoint
ALTER TABLE "app"."base_prices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."organization_sports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."base_prices", "app"."organization_sports" FROM PUBLIC;

--> statement-breakpoint
INSERT INTO "app"."sport_types" ("code", "name") VALUES
('BADMINTON', 'Badminton'), ('PICKLEBALL', 'Pickleball'), ('FUTSAL', 'Futsal'),
('TENNIS', 'Tennis'), ('PADEL', 'Padel'), ('BASKETBALL', 'Basketball'),
('SQUASH', 'Squash'), ('TABLE_TENNIS', 'Table Tennis'), ('SWIMMING', 'Swimming'),
('GOLF_SIMULATOR', 'Golf Simulator'), ('OTHER', 'Other')
ON CONFLICT ("code") DO NOTHING;
