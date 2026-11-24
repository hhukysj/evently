ALTER TYPE "public"."booking_request_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'booking_request_cancelled';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'booking_message_received';--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "cancelled_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "cancellation_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_cancellation_metadata_valid" CHECK (
	("cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL AND "cancellation_reason" IS NULL)
	OR ("cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL AND ("cancellation_reason" IS NULL OR char_length(btrim("cancellation_reason")) BETWEEN 1 AND 500))
);--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_booking_request_id_booking_requests_id_fk" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"body" varchar(2000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_nonblank" CHECK (char_length(btrim("body")) BETWEEN 1 AND 2000);--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_booking_request_unique" ON "conversations" USING btree ("booking_request_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id", "created_at", "id");--> statement-breakpoint
INSERT INTO "conversations" ("booking_request_id")
SELECT "id" FROM "booking_requests"
ON CONFLICT ("booking_request_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP INDEX "notifications_request_recipient_type_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_request_recipient_type_unique" ON "notifications" USING btree ("booking_request_id", "recipient_user_id", "type") WHERE "message_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_message_id_unique" ON "notifications" USING btree ("message_id") WHERE "message_id" IS NOT NULL;
