CREATE TABLE "reservas"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role" CHECK ("reservas"."users"."role" in ('admin', 'member')),
	CONSTRAINT "users_normalized" CHECK ("reservas"."users"."username" = lower("reservas"."users"."username") and "reservas"."users"."email" = lower("reservas"."users"."email"))
);
--> statement-breakpoint
ALTER TABLE "reservas"."bookings" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "reservas"."bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "reservas"."users"("id") ON DELETE no action ON UPDATE no action;