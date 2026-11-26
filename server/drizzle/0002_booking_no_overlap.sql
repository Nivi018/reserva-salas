CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "reservas"."bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "room_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  );
--> statement-breakpoint
INSERT INTO "reservas"."rooms" ("id", "name", "capacity") VALUES
  ('olivo', 'Sala Olivo', 4),
  ('horizonte', 'Sala Horizonte', 8),
  ('faro', 'Sala Faro', 12);
