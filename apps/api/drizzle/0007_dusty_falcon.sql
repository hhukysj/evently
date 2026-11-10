CREATE TYPE "public"."service_listing_moderation_status" AS ENUM('visible', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."service_listing_pricing_method" AS ENUM('fixed', 'starting_at', 'quote_only');--> statement-breakpoint
CREATE TYPE "public"."service_listing_publication_status" AS ENUM('draft', 'published');--> statement-breakpoint
ALTER TYPE "public"."admin_action" RENAME TO "admin_action_old";--> statement-breakpoint
CREATE TYPE "public"."admin_action" AS ENUM('suspend_user', 'approve_provider_application', 'reject_provider_application', 'hide_service_listing', 'restore_service_listing');--> statement-breakpoint
ALTER TABLE "public"."admin_audit_logs" ALTER COLUMN "action" TYPE "public"."admin_action" USING "action"::text::"public"."admin_action";--> statement-breakpoint
DROP TYPE "public"."admin_action_old";--> statement-breakpoint
CREATE TABLE "service_categories" (
	"slug" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "service_categories_sort_order_positive" CHECK ("service_categories"."sort_order" > 0),
	CONSTRAINT "service_categories_name_nonblank" CHECK (char_length(btrim("service_categories"."name")) BETWEEN 2 AND 100 AND "service_categories"."name" ~ '[^[:space:]]')
);
--> statement-breakpoint
INSERT INTO "service_categories" ("slug", "name", "sort_order") VALUES
	('planning_coordination', 'Planning and coordination', 1),
	('venues_decor', 'Venues and decor', 2),
	('catering_food', 'Catering and food', 3),
	('entertainment_performers', 'Entertainment and performers', 4),
	('photography_video', 'Photography and video', 5),
	('production_rentals', 'Production and rentals', 6),
	('transport_logistics', 'Transport and logistics', 7),
	('other_event_services', 'Other event services', 8);
--> statement-breakpoint
CREATE TABLE "service_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_profile_id" uuid NOT NULL,
	"category_slug" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" varchar(1200) NOT NULL,
	"city" varchar(120) NOT NULL,
	"region" varchar(120),
	"pricing_method" "service_listing_pricing_method" NOT NULL,
	"price_amount_paise" integer,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"publication_status" "service_listing_publication_status" DEFAULT 'draft' NOT NULL,
	"moderation_status" "service_listing_moderation_status" DEFAULT 'visible' NOT NULL,
	"moderation_hidden_by_user_id" uuid,
	"moderation_hidden_at" timestamp with time zone,
	"moderation_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_listings_title_nonblank" CHECK (char_length(btrim("service_listings"."title")) BETWEEN 2 AND 120 AND "service_listings"."title" ~ '[^[:space:]]'),
	CONSTRAINT "service_listings_description_nonblank" CHECK (char_length(btrim("service_listings"."description")) BETWEEN 20 AND 1200 AND "service_listings"."description" ~ '[^[:space:]]'),
	CONSTRAINT "service_listings_city_nonblank" CHECK (char_length(btrim("service_listings"."city")) BETWEEN 2 AND 120 AND "service_listings"."city" ~ '[^[:space:]]'),
	CONSTRAINT "service_listings_region_nonblank" CHECK ("service_listings"."region" IS NULL OR (char_length(btrim("service_listings"."region")) BETWEEN 2 AND 120 AND "service_listings"."region" ~ '[^[:space:]]')),
	CONSTRAINT "service_listings_moderation_metadata_consistent" CHECK ((
        ("service_listings"."moderation_status" = 'visible' AND "service_listings"."moderation_hidden_by_user_id" IS NULL AND "service_listings"."moderation_hidden_at" IS NULL AND "service_listings"."moderation_reason" IS NULL)
        OR ("service_listings"."moderation_status" = 'hidden' AND "service_listings"."moderation_hidden_by_user_id" IS NOT NULL AND "service_listings"."moderation_hidden_at" IS NOT NULL AND "service_listings"."moderation_reason" IS NOT NULL AND char_length(btrim("service_listings"."moderation_reason")) BETWEEN 8 AND 500 AND "service_listings"."moderation_reason" ~ '[^[:space:]]')
      )),
	CONSTRAINT "service_listings_price_consistent" CHECK ((
        ("service_listings"."pricing_method" = 'quote_only' AND "service_listings"."price_amount_paise" IS NULL)
        OR ("service_listings"."pricing_method" IN ('fixed', 'starting_at') AND "service_listings"."price_amount_paise" IS NOT NULL AND "service_listings"."price_amount_paise" >= 0)
      )),
	CONSTRAINT "service_listings_currency_inr" CHECK ("service_listings"."currency" = 'INR')
);
--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD COLUMN "service_listing_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD COLUMN "actor_user_id_snapshot" uuid;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD COLUMN "service_listing_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "service_listings" ADD CONSTRAINT "service_listings_professional_profile_id_professional_profiles_id_fk" FOREIGN KEY ("professional_profile_id") REFERENCES "public"."professional_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_listings" ADD CONSTRAINT "service_listings_category_slug_service_categories_slug_fk" FOREIGN KEY ("category_slug") REFERENCES "public"."service_categories"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_listings" ADD CONSTRAINT "service_listings_moderation_hidden_by_user_id_users_id_fk" FOREIGN KEY ("moderation_hidden_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_categories_name_unique" ON "service_categories" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "service_categories_sort_order_unique" ON "service_categories" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "service_listings_owner_created_idx" ON "service_listings" USING btree ("professional_profile_id","created_at","id");--> statement-breakpoint
CREATE INDEX "service_listings_public_created_idx" ON "service_listings" USING btree ("created_at","id") WHERE "service_listings"."publication_status" = 'published' AND "service_listings"."moderation_status" = 'visible';--> statement-breakpoint
CREATE INDEX "service_listings_category_visibility_created_idx" ON "service_listings" USING btree ("category_slug","publication_status","moderation_status","created_at","id");--> statement-breakpoint
CREATE INDEX "service_listings_city_visibility_created_idx" ON "service_listings" USING btree ("city","publication_status","moderation_status","created_at","id");--> statement-breakpoint
CREATE INDEX "service_listings_region_visibility_created_idx" ON "service_listings" USING btree ("region","publication_status","moderation_status","created_at","id");--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_service_listing_id_service_listings_id_fk" FOREIGN KEY ("service_listing_id") REFERENCES "public"."service_listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_listing_created_idx" ON "admin_audit_logs" USING btree ("service_listing_id","created_at");--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_service_listing_identity_check" CHECK ((
        "admin_audit_logs"."action" NOT IN ('hide_service_listing', 'restore_service_listing')
        OR ("admin_audit_logs"."service_listing_id" IS NOT NULL AND "admin_audit_logs"."actor_user_id_snapshot" IS NOT NULL AND ("admin_audit_logs"."actor_user_id" IS NULL OR "admin_audit_logs"."actor_user_id" = "admin_audit_logs"."actor_user_id_snapshot"))
      ));--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_service_listing_reason_check" CHECK ((
        "admin_audit_logs"."action" <> 'hide_service_listing'
        OR ("admin_audit_logs"."service_listing_reason" IS NOT NULL AND char_length(btrim("admin_audit_logs"."service_listing_reason")) BETWEEN 8 AND 500 AND "admin_audit_logs"."service_listing_reason" ~ '[^[:space:]]')
      ));