ALTER TABLE "app"."report_schedules" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
UPDATE "app"."report_schedules" AS schedule SET "branch_id" = (
  SELECT branch."id" FROM "app"."branches" AS branch
  WHERE branch."organization_id" = schedule."organization_id"
  ORDER BY branch."created_at", branch."id" LIMIT 1
) WHERE schedule."branch_id" IS NULL;--> statement-breakpoint
ALTER TABLE "app"."report_schedules" ADD CONSTRAINT "report_schedules_org_branch_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "app"."branches"("organization_id","id") ON DELETE no action ON UPDATE no action;
