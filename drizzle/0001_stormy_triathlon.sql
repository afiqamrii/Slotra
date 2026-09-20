CREATE TABLE "app"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_role_ck" CHECK ("app"."invitations"."role" in ('ADMIN','MANAGER','STAFF','VIEWER')),
	CONSTRAINT "invitations_status_ck" CHECK ("app"."invitations"."status" in ('PENDING','ACCEPTED','EXPIRED','REVOKED'))
);
--> statement-breakpoint
CREATE TABLE "app"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "app"."verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_uq" ON "app"."accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "app"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitations_org_status_idx" ON "app"."invitations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "invitations_email_status_idx" ON "app"."invitations" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "sessions_user_expires_idx" ON "app"."sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "app"."verifications" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "app"."accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."verifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."invitations" ENABLE ROW LEVEL SECURITY;
