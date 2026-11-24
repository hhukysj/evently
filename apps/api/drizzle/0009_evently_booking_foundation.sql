CREATE TYPE "public"."booking_request_status" AS ENUM('requested', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('booking_request_received', 'booking_request_accepted', 'booking_request_declined');--> statement-breakpoint
CREATE TABLE "booking_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"professional_user_id" uuid NOT NULL,
	"submitted_service_listing_id_snapshot" uuid NOT NULL,
	"service_listing_id" uuid,
	"service_title_snapshot" varchar(120) NOT NULL,
	"service_description_snapshot" varchar(1200) NOT NULL,
	"service_city_snapshot" varchar(120) NOT NULL,
	"service_region_snapshot" varchar(120),
	"service_category_slug_snapshot" varchar(64) NOT NULL,
	"service_category_name_snapshot" varchar(100) NOT NULL,
	"service_pricing_method_snapshot" "service_listing_pricing_method" NOT NULL,
	"service_price_amount_paise_snapshot" integer,
	"service_currency_snapshot" varchar(3) NOT NULL,
	"provider_display_name_snapshot" varchar(120) NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"event_date" date NOT NULL,
	"event_timezone" varchar(64) NOT NULL,
	"event_city" varchar(120) NOT NULL,
	"event_region" varchar(120),
	"event_venue_or_area" varchar(200),
	"guest_count" integer NOT NULL,
	"budget_min_amount_paise" integer,
	"budget_max_amount_paise" integer,
	"additional_notes" varchar(1200),
	"status" "booking_request_status" DEFAULT 'requested' NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_requests_participants_distinct" CHECK ("customer_user_id" <> "professional_user_id"),
	CONSTRAINT "booking_requests_service_snapshot_nonblank" CHECK (
		char_length(btrim("service_title_snapshot")) BETWEEN 2 AND 120
		AND char_length(btrim("service_description_snapshot")) BETWEEN 20 AND 1200
		AND char_length(btrim("service_city_snapshot")) BETWEEN 2 AND 120
		AND ("service_region_snapshot" IS NULL OR char_length(btrim("service_region_snapshot")) BETWEEN 2 AND 120)
		AND char_length(btrim("service_category_slug_snapshot")) BETWEEN 1 AND 64
		AND char_length(btrim("service_category_name_snapshot")) BETWEEN 2 AND 100
		AND char_length(btrim("provider_display_name_snapshot")) BETWEEN 2 AND 120
	),
	CONSTRAINT "booking_requests_service_price_consistent" CHECK (
		("service_pricing_method_snapshot" = 'quote_only' AND "service_price_amount_paise_snapshot" IS NULL)
		OR ("service_pricing_method_snapshot" IN ('fixed', 'starting_at') AND "service_price_amount_paise_snapshot" IS NOT NULL AND "service_price_amount_paise_snapshot" >= 0)
	),
	CONSTRAINT "booking_requests_service_currency_inr" CHECK ("service_currency_snapshot" = 'INR'),
	CONSTRAINT "booking_requests_event_fields_valid" CHECK (
		char_length(btrim("event_type")) BETWEEN 2 AND 120
		AND char_length(btrim("event_timezone")) BETWEEN 1 AND 64
		AND char_length(btrim("event_city")) BETWEEN 2 AND 120
		AND ("event_region" IS NULL OR char_length(btrim("event_region")) BETWEEN 2 AND 120)
		AND ("event_venue_or_area" IS NULL OR char_length(btrim("event_venue_or_area")) BETWEEN 2 AND 200)
		AND ("additional_notes" IS NULL OR char_length(btrim("additional_notes")) BETWEEN 1 AND 1200)
	),
	CONSTRAINT "booking_requests_guest_count_valid" CHECK ("guest_count" BETWEEN 1 AND 100000),
	CONSTRAINT "booking_requests_budget_nonnegative" CHECK (("budget_min_amount_paise" IS NULL OR "budget_min_amount_paise" >= 0) AND ("budget_max_amount_paise" IS NULL OR "budget_max_amount_paise" >= 0)),
	CONSTRAINT "booking_requests_budget_ordered" CHECK ("budget_min_amount_paise" IS NULL OR "budget_max_amount_paise" IS NULL OR "budget_min_amount_paise" <= "budget_max_amount_paise")
);
--> statement-breakpoint
CREATE TABLE "booking_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_request_id" uuid NOT NULL,
	"previous_status" "booking_request_status",
	"new_status" "booking_request_status" NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_status_history_transition_valid" CHECK (("previous_status" IS NULL AND "new_status" = 'requested') OR ("previous_status" IS NOT NULL AND "previous_status" <> "new_status")),
	CONSTRAINT "booking_status_history_reason_valid" CHECK ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"booking_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_service_listing_id_service_listings_id_fk" FOREIGN KEY ("service_listing_id") REFERENCES "public"."service_listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_request_id_booking_requests_id_fk" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_request_id_booking_requests_id_fk" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_requests_customer_idempotency_unique" ON "booking_requests" USING btree ("customer_user_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX "booking_requests_customer_created_idx" ON "booking_requests" USING btree ("customer_user_id", "created_at", "id");--> statement-breakpoint
CREATE INDEX "booking_requests_professional_status_created_idx" ON "booking_requests" USING btree ("professional_user_id", "status", "created_at", "id");--> statement-breakpoint
CREATE INDEX "booking_status_history_request_created_idx" ON "booking_status_history" USING btree ("booking_request_id", "created_at", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_request_recipient_type_unique" ON "notifications" USING btree ("booking_request_id", "recipient_user_id", "type");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_user_id", "created_at", "id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_created_idx" ON "notifications" USING btree ("recipient_user_id", "created_at", "id") WHERE "read_at" IS NULL;
