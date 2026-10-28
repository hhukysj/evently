ALTER TABLE "provider_applications" DROP CONSTRAINT "provider_applications_review_state_check";--> statement-breakpoint
ALTER TABLE "provider_applications" DROP CONSTRAINT "provider_applications_reviewer_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_review_state_check" CHECK ((
        ("provider_applications"."status" = 'pending' AND "provider_applications"."reviewer_user_id" IS NULL AND "provider_applications"."reviewed_at" IS NULL AND "provider_applications"."rejection_reason" IS NULL)
        OR ("provider_applications"."status" = 'approved' AND "provider_applications"."reviewer_user_id" IS NOT NULL AND "provider_applications"."reviewed_at" IS NOT NULL AND "provider_applications"."rejection_reason" IS NULL)
        OR ("provider_applications"."status" = 'rejected' AND "provider_applications"."reviewer_user_id" IS NOT NULL AND "provider_applications"."reviewed_at" IS NOT NULL AND "provider_applications"."rejection_reason" IS NOT NULL AND char_length(btrim("provider_applications"."rejection_reason")) BETWEEN 8 AND 500)
      ));