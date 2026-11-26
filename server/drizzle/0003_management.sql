CREATE TABLE "reservas"."audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
ALTER TABLE "reservas"."bookings" DROP CONSTRAINT "bookings_valid_duration";--> statement-breakpoint
ALTER TABLE "reservas"."bookings" ADD COLUMN "kind" text DEFAULT 'booking' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas"."bookings" ADD COLUMN "booked_for" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas"."bookings" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas"."bookings" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservas"."bookings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas"."rooms" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas"."rooms" ADD COLUMN "open_minute" integer DEFAULT 480 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas"."rooms" ADD COLUMN "close_minute" integer DEFAULT 1200 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas"."rooms" ADD COLUMN "time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas"."rooms" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas"."bookings" ADD CONSTRAINT "bookings_valid_duration" CHECK (("reservas"."bookings"."kind" = 'booking' and extract(epoch from ("reservas"."bookings"."ends_at" - "reservas"."bookings"."starts_at")) in (1800, 3600, 5400, 7200)) or ("reservas"."bookings"."kind" = 'block' and extract(epoch from ("reservas"."bookings"."ends_at" - "reservas"."bookings"."starts_at")) between 60 and 2678400));--> statement-breakpoint
ALTER TABLE "reservas"."rooms" ADD CONSTRAINT "rooms_daily_schedule" CHECK ("reservas"."rooms"."open_minute" >= 0 and "reservas"."rooms"."close_minute" <= 1440 and "reservas"."rooms"."open_minute" < "reservas"."rooms"."close_minute" and "reservas"."rooms"."open_minute" % 30 = 0 and "reservas"."rooms"."close_minute" % 30 = 0);