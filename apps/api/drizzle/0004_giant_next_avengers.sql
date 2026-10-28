CREATE TYPE "public"."professional_profile_status" AS ENUM('draft');--> statement-breakpoint
CREATE TYPE "public"."provider_application_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('event_organizer', 'event_manager', 'artist_performer', 'vendor_service_provider');--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'approve_provider_application';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'reject_provider_application';--> statement-breakpoint
CREATE TABLE "professional_profile_types" (
	"profile_id" uuid NOT NULL,
	"provider_type" "provider_type" NOT NULL,
	CONSTRAINT "professional_profile_types_pk" PRIMARY KEY("profile_id","provider_type")
);
--> statement-breakpoint
CREATE TABLE "professional_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"headline" varchar(160),
	"bio" varchar(1200),
	"city" varchar(120) NOT NULL,
	"region" varchar(120),
	"country" varchar(80) NOT NULL,
	"status" "professional_profile_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_application_types" (
	"application_id" uuid NOT NULL,
	"provider_type" "provider_type" NOT NULL,
	CONSTRAINT "provider_application_types_pk" PRIMARY KEY("application_id","provider_type")
);
--> statement-breakpoint
CREATE TABLE "provider_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"description" varchar(1200) NOT NULL,
	"city" varchar(120) NOT NULL,
	"region" varchar(120),
	"country" varchar(80) NOT NULL,
	"status" "provider_application_status" DEFAULT 'pending' NOT NULL,
	"reviewer_user_id" uuid,
	"rejection_reason" varchar(500),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_applications_review_state_check" CHECK ((
        ("provider_applications"."status" = 'pending' AND "provider_applications"."reviewer_user_id" IS NULL AND "provider_applications"."reviewed_at" IS NULL AND "provider_applications"."rejection_reason" IS NULL)
        OR ("provider_applications"."status" = 'approved' AND "provider_applications"."reviewer_user_id" IS NOT NULL AND "provider_applications"."reviewed_at" IS NOT NULL AND "provider_applications"."rejection_reason" IS NULL)
        OR ("provider_applications"."status" = 'rejected' AND "provider_applications"."reviewer_user_id" IS NOT NULL AND "provider_applications"."reviewed_at" IS NOT NULL AND "provider_applications"."rejection_reason" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD COLUMN "provider_application_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "professional_profile_types" ADD CONSTRAINT "professional_profile_types_profile_id_professional_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."professional_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_application_types" ADD CONSTRAINT "provider_application_types_application_id_provider_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."provider_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "professional_profile_types_type_idx" ON "professional_profile_types" USING btree ("provider_type");--> statement-breakpoint
CREATE UNIQUE INDEX "professional_profiles_user_unique" ON "professional_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "professional_profiles_slug_unique" ON "professional_profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "professional_profiles_status_created_idx" ON "professional_profiles" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "provider_application_types_type_idx" ON "provider_application_types" USING btree ("provider_type");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_applications_one_pending_per_user" ON "provider_applications" USING btree ("user_id") WHERE "provider_applications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "provider_applications_status_created_idx" ON "provider_applications" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "provider_applications_user_created_idx" ON "provider_applications" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_provider_application_id_provider_applications_id_fk" FOREIGN KEY ("provider_application_id") REFERENCES "public"."provider_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_application_created_idx" ON "admin_audit_logs" USING btree ("provider_application_id","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_version_nonnegative" CHECK ("users"."auth_version" >= 0);