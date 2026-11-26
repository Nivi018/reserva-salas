CREATE TABLE "reservas"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_valid_duration" CHECK (extract(epoch from ("reservas"."bookings"."ends_at" - "reservas"."bookings"."starts_at")) in (1800, 3600, 5400, 7200))
);
--> statement-breakpoint
CREATE TABLE "reservas"."rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	CONSTRAINT "rooms_positive_capacity" CHECK ("reservas"."rooms"."capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "reservas"."bookings" ADD CONSTRAINT "bookings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "reservas"."rooms"("id") ON DELETE no action ON UPDATE no action;