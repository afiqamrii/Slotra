import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, foreignKey, index, integer, jsonb, pgSchema, text,
  timestamp, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";

export const app = pgSchema("app");
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
};

export const users = app.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
}, (table) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${table.email})`)]);

export const organizations = app.table("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  logoUrl: text("logo_url"),
  displayName: text("display_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  city: text("city"),
  state: text("state"),
  postcode: text("postcode"),
  country: varchar("country", { length: 2 }).notNull().default("MY"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true, mode: "date" }),
  isActive: boolean("is_active").notNull().default(true),
  planCode: varchar("plan_code", { length: 20 }).notNull().default("STARTER"),
  primaryColor: varchar("primary_color", { length: 7 }),
  timezone: text("timezone").notNull().default("Asia/Kuala_Lumpur"),
  currency: varchar("currency", { length: 3 }).notNull().default("MYR"),
  locale: varchar("locale", { length: 20 }).notNull().default("en-MY"),
  ...timestamps,
}, (table) => [
  check("organizations_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("organizations_plan_code_ck", sql`${table.planCode} in ('STARTER','PROFESSIONAL','BUSINESS','PRO')`),
]);

export const organizationMembers = app.table("organization_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  role: varchar("role", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  ...timestamps,
}, (table) => [
  uniqueIndex("organization_members_org_user_uq").on(table.organizationId, table.userId),
  index("organization_members_user_idx").on(table.userId),
  check("organization_members_role_ck", sql`${table.role} in ('OWNER','ADMIN','MANAGER','STAFF','VIEWER')`),
  check("organization_members_status_ck", sql`${table.status} in ('ACTIVE','INVITED','SUSPENDED')`),
]);

export const branches = app.table("branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 100 }).notNull(),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  city: text("city"),
  state: text("state"),
  postcode: text("postcode"),
  country: varchar("country", { length: 2 }).notNull().default("MY"),
  timezone: text("timezone").notNull().default("Asia/Kuala_Lumpur"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("branches_org_id_uq").on(table.organizationId, table.id),
  uniqueIndex("branches_org_slug_uq").on(table.organizationId, table.slug),
  index("branches_org_active_idx").on(table.organizationId, table.isActive),
  check("branches_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]);

// Global catalog; adding a sport is data, not a schema migration.
export const sportTypes = app.table("sport_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 60 }).notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const organizationSports = app.table("organization_sports", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  sportTypeId: uuid("sport_type_id").notNull().references(() => sportTypes.id),
}, (table) => [uniqueIndex("organization_sports_org_sport_uq").on(table.organizationId, table.sportTypeId)]);

// A branch/sport base rate, kept separate from resources for future pricing rules.
export const basePrices = app.table("base_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  branchId: uuid("branch_id").notNull(),
  sportTypeId: uuid("sport_type_id").notNull().references(() => sportTypes.id),
  amountMinor: integer("amount_minor").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  ...timestamps,
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.branchId], foreignColumns: [branches.organizationId, branches.id], name: "base_prices_org_branch_fk" }),
  uniqueIndex("base_prices_org_branch_sport_uq").on(table.organizationId, table.branchId, table.sportTypeId),
  check("base_prices_amount_ck", sql`${table.amountMinor} >= 0 and ${table.durationMinutes} > 0`),
]);
export const resources = app.table("resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  branchId: uuid("branch_id").notNull(),
  sportTypeId: uuid("sport_type_id").notNull().references(() => sportTypes.id),
  name: text("name").notNull(),
  description: text("description"),
  displayType: varchar("display_type", { length: 40 }),
  capacity: integer("capacity"),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  imageUrl: text("image_url"),
  minimumDurationMinutes: integer("minimum_duration_minutes").notNull().default(60),
  maximumDurationMinutes: integer("maximum_duration_minutes"),
  bookingIntervalMinutes: integer("booking_interval_minutes").notNull().default(30),
  minimumAdvanceMinutes: integer("minimum_advance_minutes").notNull().default(0),
  maximumAdvanceDays: integer("maximum_advance_days"),
  ...timestamps,
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.branchId], foreignColumns: [branches.organizationId, branches.id], name: "resources_org_branch_fk" }),
  uniqueIndex("resources_org_branch_id_uq").on(table.organizationId, table.branchId, table.id),
  uniqueIndex("resources_org_branch_name_uq").on(table.organizationId, table.branchId, table.name),
  index("resources_org_branch_status_idx").on(table.organizationId, table.branchId, table.status),
  index("resources_sport_type_idx").on(table.sportTypeId),
  check("resources_status_ck", sql`${table.status} in ('ACTIVE','MAINTENANCE','DISABLED')`),
  check("resources_capacity_ck", sql`${table.capacity} is null or ${table.capacity} > 0`),
  check("resources_duration_ck", sql`${table.minimumDurationMinutes} > 0 and (${table.maximumDurationMinutes} is null or ${table.maximumDurationMinutes} >= ${table.minimumDurationMinutes}) and ${table.bookingIntervalMinutes} > 0`),
  check("resources_advance_ck", sql`${table.minimumAdvanceMinutes} >= 0 and (${table.maximumAdvanceDays} is null or ${table.maximumAdvanceDays} > 0)`),
]);

// Minutes from the beginning of the named local weekday; end may cross midnight.
export const operatingHours = app.table("operating_hours", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  branchId: uuid("branch_id").notNull(),
  resourceId: uuid("resource_id"),
  dayOfWeek: integer("day_of_week").notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
  ...timestamps,
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.branchId], foreignColumns: [branches.organizationId, branches.id], name: "operating_hours_org_branch_fk" }),
  foreignKey({ columns: [table.organizationId, table.branchId, table.resourceId], foreignColumns: [resources.organizationId, resources.branchId, resources.id], name: "operating_hours_org_resource_fk" }),
  index("operating_hours_org_branch_day_idx").on(table.organizationId, table.branchId, table.dayOfWeek),
  index("operating_hours_resource_day_idx").on(table.resourceId, table.dayOfWeek),
  check("operating_hours_day_ck", sql`${table.dayOfWeek} between 0 and 6`),
  check("operating_hours_range_ck", sql`${table.startMinute} between 0 and 1439 and ${table.endMinute} > ${table.startMinute} and ${table.endMinute} <= 2880`),
]);

export const resourceBlocks = app.table("resource_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  branchId: uuid("branch_id").notNull(),
  resourceId: uuid("resource_id").notNull(),
  startAt: timestamp("start_at", { withTimezone: true, mode: "date" }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true, mode: "date" }).notNull(),
  reason: text("reason"),
  type: varchar("type", { length: 20 }).notNull().default("MANUAL"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.branchId, table.resourceId], foreignColumns: [resources.organizationId, resources.branchId, resources.id], name: "resource_blocks_org_resource_fk" }),
  index("resource_blocks_resource_start_idx").on(table.organizationId, table.resourceId, table.startAt),
  check("resource_blocks_range_ck", sql`${table.endAt} > ${table.startAt}`),
  check("resource_blocks_type_ck", sql`${table.type} in ('MANUAL','MAINTENANCE','PRIVATE_EVENT','OTHER')`),
]);

export const customers = app.table("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone").notNull(),
  notes: text("notes"),
  ...timestamps,
}, (table) => [
  uniqueIndex("customers_org_id_uq").on(table.organizationId, table.id),
  index("customers_org_phone_idx").on(table.organizationId, table.phone),
  index("customers_org_email_idx").on(table.organizationId, table.email),
]);


export const bookingStatuses = ["PENDING", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "EXPIRED"] as const;
export type BookingStatus = (typeof bookingStatuses)[number];
export const bookingSources = ["ONLINE", "STAFF", "WALK_IN", "IMPORT", "API"] as const;
export type BookingSource = (typeof bookingSources)[number];

// Immutable monetary snapshot in minor currency units. The active-state exclusion
// constraint is added in migration SQL because Drizzle cannot express it directly.
export const bookings = app.table("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  branchId: uuid("branch_id").notNull(),
  customerId: uuid("customer_id"),
  resourceId: uuid("resource_id").notNull(),
  bookingReference: varchar("booking_reference", { length: 20 }).notNull(),
  publicAccessTokenHash: varchar("public_access_token_hash", { length: 64 }),
  startAt: timestamp("start_at", { withTimezone: true, mode: "date" }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true, mode: "date" }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  source: varchar("source", { length: 20 }).notNull(),
  notes: text("notes"),
  subtotal: integer("subtotal").notNull(),
  discountAmount: integer("discount_amount").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  amountPaid: integer("amount_paid").notNull().default(0),
  paymentRequirement: varchar("payment_requirement", { length: 24 }).notNull().default("NO_UPFRONT"),
  requiredNowMinor: integer("required_now_minor").notNull().default(0),
  holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true, mode: "date" }),
  currency: varchar("currency", { length: 3 }).notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
  cancellationReason: text("cancellation_reason"),
  ...timestamps,
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.branchId, table.resourceId], foreignColumns: [resources.organizationId, resources.branchId, resources.id], name: "bookings_org_resource_fk" }),
  foreignKey({ columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id], name: "bookings_org_customer_fk" }),
  uniqueIndex("bookings_org_id_uq").on(table.organizationId, table.id),
  uniqueIndex("bookings_org_reference_uq").on(table.organizationId, table.bookingReference),
  uniqueIndex("bookings_public_access_token_hash_uq").on(table.publicAccessTokenHash),
  index("bookings_org_branch_start_idx").on(table.organizationId, table.branchId, table.startAt),
  index("bookings_org_resource_start_idx").on(table.organizationId, table.resourceId, table.startAt),
  check("bookings_range_ck", sql`${table.endAt} > ${table.startAt}`),
  check("bookings_status_ck", sql`${table.status} in ('PENDING','AWAITING_PAYMENT','CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW','EXPIRED')`),
  check("bookings_source_ck", sql`${table.source} in ('ONLINE','STAFF','WALK_IN','IMPORT','API')`),
  check("bookings_money_ck", sql`${table.subtotal} >= 0 and ${table.discountAmount} >= 0 and ${table.taxAmount} >= 0 and ${table.totalAmount} = ${table.subtotal} - ${table.discountAmount} + ${table.taxAmount} and ${table.amountPaid} >= 0 and ${table.amountPaid} <= ${table.totalAmount}`),
  check("bookings_payment_snapshot_ck", sql`${table.paymentRequirement} in ('NO_UPFRONT','FULL','FIXED_DEPOSIT','PERCENT_DEPOSIT') and ${table.requiredNowMinor} between 0 and ${table.totalAmount} and (${table.requiredNowMinor} = 0 or ${table.holdExpiresAt} is not null)`),
]);

export const bookingStatusHistory = app.table("booking_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  bookingId: uuid("booking_id").notNull(),
  eventType: varchar("event_type", { length: 20 }).notNull().default("STATUS_CHANGED"),
  previousStatus: varchar("previous_status", { length: 24 }),
  newStatus: varchar("new_status", { length: 24 }).notNull(),
  previousStartAt: timestamp("previous_start_at", { withTimezone: true, mode: "date" }),
  previousEndAt: timestamp("previous_end_at", { withTimezone: true, mode: "date" }),
  newStartAt: timestamp("new_start_at", { withTimezone: true, mode: "date" }),
  newEndAt: timestamp("new_end_at", { withTimezone: true, mode: "date" }),
  previousResourceId: uuid("previous_resource_id"),
  newResourceId: uuid("new_resource_id"),
  previousTotalAmount: integer("previous_total_amount"),
  newTotalAmount: integer("new_total_amount"),
  changedByUserId: uuid("changed_by_user_id").references(() => users.id),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.bookingId], foreignColumns: [bookings.organizationId, bookings.id], name: "booking_history_org_booking_fk" }),
  index("booking_history_org_booking_created_idx").on(table.organizationId, table.bookingId, table.createdAt),
  check("booking_history_event_ck", sql`${table.eventType} in ('STATUS_CHANGED','RESCHEDULED')`),
]);

// One immutable billable-use record per first confirmation, including later-cancelled bookings.
export const bookingUsageRecords = app.table("booking_usage_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  bookingId: uuid("booking_id").notNull(),
  periodStartAt: timestamp("period_start_at", { withTimezone: true, mode: "date" }).notNull(),
  periodEndAt: timestamp("period_end_at", { withTimezone: true, mode: "date" }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.bookingId], foreignColumns: [bookings.organizationId, bookings.id], name: "booking_usage_org_booking_fk" }),
  uniqueIndex("booking_usage_org_booking_uq").on(table.organizationId, table.bookingId),
  index("booking_usage_org_period_idx").on(table.organizationId, table.periodStartAt),
  check("booking_usage_period_ck", sql`${table.periodEndAt} > ${table.periodStartAt}`),
]);

// Transactional notification outbox. Delivery happens after the booking commits.
export const notificationRecords = app.table("notification_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  bookingId: uuid("booking_id").notNull(),
  eventKey: uuid("event_key").notNull(),
  type: varchar("type", { length: 30 }).notNull(),
  channel: varchar("channel", { length: 20 }).notNull().default("EMAIL"),
  recipient: text("recipient"),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  providerMessageId: text("provider_message_id"),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  failureReason: text("failure_reason"),
  ...timestamps,
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.bookingId], foreignColumns: [bookings.organizationId, bookings.id], name: "notification_org_booking_fk" }),
  uniqueIndex("notification_org_event_uq").on(table.organizationId, table.eventKey),
  index("notification_org_booking_idx").on(table.organizationId, table.bookingId),
  check("notification_type_ck", sql`${table.type} in ('BOOKING_CONFIRMED','BOOKING_RESCHEDULED','BOOKING_CANCELLED')`),
  check("notification_status_ck", sql`${table.status} in ('PENDING','SENT','FAILED','DEV_PREVIEW','SKIPPED')`),
]);

// Professional scheduled-report configuration and per-recipient delivery attempts.
export const reportSchedules = app.table("report_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  reportType: varchar("report_type", { length: 20 }).notNull().default("OVERVIEW"),
  frequency: varchar("frequency", { length: 20 }).notNull(),
  recipients: jsonb("recipients").$type<string[]>().notNull(),
  timezone: text("timezone").notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: "date" }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, table => [
  uniqueIndex("report_schedules_org_id_uq").on(table.organizationId, table.id),
  index("report_schedules_due_idx").on(table.nextRunAt).where(sql`${table.isActive} = true`),
  index("report_schedules_org_idx").on(table.organizationId),
  check("report_schedules_type_ck", sql`${table.reportType} in ('OVERVIEW','REVENUE','BOOKINGS','RESOURCES','CUSTOMERS')`),
  check("report_schedules_frequency_ck", sql`${table.frequency} in ('WEEKLY','MONTHLY')`),
]);
export const reportDeliveries = app.table("report_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  scheduleId: uuid("schedule_id").notNull(),
  periodStart: varchar("period_start", { length: 10 }).notNull(),
  periodEnd: varchar("period_end", { length: 10 }).notNull(),
  recipient: text("recipient").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  providerMessageId: text("provider_message_id"),
  failureReason: text("failure_reason"),
  ...timestamps,
}, table => [
  foreignKey({ columns: [table.organizationId, table.scheduleId],
    foreignColumns: [reportSchedules.organizationId, reportSchedules.id], name: "report_deliveries_org_schedule_fk" }),
  uniqueIndex("report_deliveries_once_uq").on(table.scheduleId, table.periodStart, table.recipient),
  index("report_deliveries_org_schedule_idx").on(table.organizationId, table.scheduleId),
  check("report_deliveries_status_ck", sql`${table.status} in ('PENDING','PROCESSING','SENT','FAILED','DEV_PREVIEW')`),
]);

// Development-only, one-time ToyyibPay sandbox plan test. Not a SaaS subscription ledger.
export const planUpgradeAttempts = app.table("plan_upgrade_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  fromPlan: varchar("from_plan", { length: 20 }).notNull(),
  targetPlan: varchar("target_plan", { length: 20 }).notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  provider: varchar("provider", { length: 40 }).notNull().default("TOYYIBPAY_SANDBOX"),
  providerBillCode: varchar("provider_bill_code", { length: 40 }),
  providerReference: text("provider_reference"),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
  ...timestamps,
}, table => [
  uniqueIndex("plan_upgrade_org_id_uq").on(table.organizationId, table.id),
  uniqueIndex("plan_upgrade_bill_uq").on(table.provider, table.providerBillCode)
    .where(sql`${table.providerBillCode} is not null`),
  uniqueIndex("plan_upgrade_one_active_uq").on(table.organizationId)
    .where(sql`${table.status} in ('PENDING','PROCESSING')`),
  index("plan_upgrade_org_created_idx").on(table.organizationId, table.createdAt),
  check("plan_upgrade_status_ck", sql`${table.status} in ('PENDING','PROCESSING','PAID','FAILED','EXPIRED')`),
  check("plan_upgrade_amount_ck", sql`${table.amountMinor} > 0`),
  check("plan_upgrade_target_ck", sql`${table.fromPlan} = 'STARTER' and ${table.targetPlan} = 'PROFESSIONAL'`),
]);


export const paymentRequirements = ["NO_UPFRONT", "FULL", "FIXED_DEPOSIT", "PERCENT_DEPOSIT"] as const;
export type PaymentRequirement = (typeof paymentRequirements)[number];
export const paymentStatuses = ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export const paymentTypes = ["FULL_PAYMENT", "DEPOSIT", "BALANCE_PAYMENT", "MANUAL_PAYMENT"] as const;
export const refundStatuses = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"] as const;

export const organizationPaymentSettings = app.table("organization_payment_settings", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id),
  requirement: varchar("requirement", { length: 24 }).notNull().default("NO_UPFRONT"),
  fixedDepositMinor: integer("fixed_deposit_minor"),
  depositPercentage: integer("deposit_percentage"),
  manualEnabled: boolean("manual_enabled").notNull().default(true),
  holdMinutes: integer("hold_minutes").notNull().default(10),
  ...timestamps,
}, (table) => [
  check("payment_settings_requirement_ck", sql`${table.requirement} in ('NO_UPFRONT','FULL','FIXED_DEPOSIT','PERCENT_DEPOSIT')`),
  check("payment_settings_values_ck", sql`(${table.fixedDepositMinor} is null or ${table.fixedDepositMinor} > 0) and (${table.depositPercentage} is null or ${table.depositPercentage} between 1 and 100) and ${table.holdMinutes} between 5 and 30`),
]);

export const organizationPaymentAccounts = app.table("organization_payment_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("CONNECTED"),
  isDefault: boolean("is_default").notNull().default(false),
  ...timestamps,
}, (table) => [
  uniqueIndex("payment_accounts_org_id_uq").on(table.organizationId, table.id),
  uniqueIndex("payment_accounts_org_provider_account_uq").on(table.organizationId, table.provider, table.providerAccountId),
  uniqueIndex("payment_accounts_one_default_uq").on(table.organizationId).where(sql`${table.isDefault} = true and ${table.status} = 'CONNECTED'`),
  check("payment_accounts_status_ck", sql`${table.status} in ('CONNECTED','DISCONNECTED','PENDING')`),
]);

export const payments = app.table("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  bookingId: uuid("booking_id").notNull(),
  providerAccountId: uuid("provider_account_id"),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerPaymentId: text("provider_payment_id"),
  providerReference: text("provider_reference"),
  idempotencyKey: uuid("idempotency_key"),
  amountMinor: integer("amount_minor").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("PENDING"),
  paymentMethod: varchar("payment_method", { length: 30 }),
  type: varchar("type", { length: 24 }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
  failedAt: timestamp("failed_at", { withTimezone: true, mode: "date" }),
  failureReason: text("failure_reason"),
  recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
  ...timestamps,
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.bookingId], foreignColumns: [bookings.organizationId, bookings.id], name: "payments_org_booking_fk" }),
  foreignKey({ columns: [table.organizationId, table.providerAccountId], foreignColumns: [organizationPaymentAccounts.organizationId, organizationPaymentAccounts.id], name: "payments_org_account_fk" }),
  uniqueIndex("payments_org_id_uq").on(table.organizationId, table.id),
  uniqueIndex("payments_org_id_booking_uq").on(table.organizationId, table.id, table.bookingId),
  uniqueIndex("payments_org_idempotency_uq").on(table.organizationId, table.idempotencyKey).where(sql`${table.idempotencyKey} is not null`),
  uniqueIndex("payments_provider_payment_uq").on(table.provider, table.providerPaymentId).where(sql`${table.providerPaymentId} is not null`),
  index("payments_org_booking_idx").on(table.organizationId, table.bookingId),
  check("payments_amount_ck", sql`${table.amountMinor} > 0`),
  check("payments_status_ck", sql`${table.status} in ('PENDING','PROCESSING','PAID','FAILED','CANCELLED','PARTIALLY_REFUNDED','REFUNDED')`),
  check("payments_type_ck", sql`${table.type} in ('FULL_PAYMENT','DEPOSIT','BALANCE_PAYMENT','MANUAL_PAYMENT')`),
]);

export const refunds = app.table("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  paymentId: uuid("payment_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  providerRefundId: text("provider_refund_id"),
  idempotencyKey: uuid("idempotency_key"),
  amountMinor: integer("amount_minor").notNull(),
  reason: text("reason"),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  ...timestamps,
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.paymentId], foreignColumns: [payments.organizationId, payments.id], name: "refunds_org_payment_fk" }),
  foreignKey({ columns: [table.organizationId, table.paymentId, table.bookingId], foreignColumns: [payments.organizationId, payments.id, payments.bookingId], name: "refunds_payment_booking_fk" }),
  foreignKey({ columns: [table.organizationId, table.bookingId], foreignColumns: [bookings.organizationId, bookings.id], name: "refunds_org_booking_fk" }),
  uniqueIndex("refunds_org_idempotency_uq").on(table.organizationId, table.idempotencyKey).where(sql`${table.idempotencyKey} is not null`),
  uniqueIndex("refunds_provider_refund_uq").on(table.providerRefundId).where(sql`${table.providerRefundId} is not null`),
  index("refunds_org_payment_idx").on(table.organizationId, table.paymentId),
  check("refunds_amount_ck", sql`${table.amountMinor} > 0`),
  check("refunds_status_ck", sql`${table.status} in ('PENDING','PROCESSING','SUCCEEDED','FAILED')`),
]);

export const paymentWebhookEvents = app.table("payment_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerEventId: text("provider_event_id").notNull(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  paymentId: uuid("payment_id").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.paymentId], foreignColumns: [payments.organizationId, payments.id], name: "payment_events_org_payment_fk" }),
  uniqueIndex("payment_events_provider_event_uq").on(table.provider, table.providerEventId),
  index("payment_events_org_payment_idx").on(table.organizationId, table.paymentId),
]);

export const paymentAuditLogs = app.table("payment_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  bookingId: uuid("booking_id"),
  paymentId: uuid("payment_id"),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 60 }).notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [index("payment_audit_org_created_idx").on(table.organizationId, table.createdAt)]);
// Better Auth's credential/account, session, and verification records share the existing user identity.
export const sessions = app.table("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  ...timestamps,
}, (table) => [index("sessions_user_expires_idx").on(table.userId, table.expiresAt)]);

export const accounts = app.table("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  ...timestamps,
}, (table) => [
  uniqueIndex("accounts_provider_account_uq").on(table.providerId, table.accountId),
  index("accounts_user_idx").on(table.userId),
]);

export const verifications = app.table("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  ...timestamps,
}, (table) => [index("verifications_identifier_idx").on(table.identifier)]);

export const invitations = app.table("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  email: text("email").notNull(),
  role: varchar("role", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
  ...timestamps,
}, (table) => [
  index("invitations_org_status_idx").on(table.organizationId, table.status),
  index("invitations_email_status_idx").on(table.email, table.status),
  check("invitations_role_ck", sql`${table.role} in ('ADMIN','MANAGER','STAFF','VIEWER')`),
  check("invitations_status_ck", sql`${table.status} in ('PENDING','ACCEPTED','EXPIRED','REVOKED')`),
]);


export const rateLimits = app.table("rate_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});









