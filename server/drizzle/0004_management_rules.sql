ALTER TABLE reservas.bookings
  DROP CONSTRAINT bookings_no_overlap,
  ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (cancelled_at IS NULL);
--> statement-breakpoint
CREATE INDEX bookings_starts_at_idx ON reservas.bookings (starts_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX audit_at_idx ON reservas.audit (at DESC, id DESC);
--> statement-breakpoint
CREATE FUNCTION reservas.check_booking_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  room reservas.rooms%ROWTYPE;
  local_start timestamp;
  local_end timestamp;
BEGIN
  IF NEW.cancelled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.room_id = NEW.room_id AND OLD.starts_at = NEW.starts_at AND OLD.ends_at = NEW.ends_at
      AND OLD.kind = NEW.kind AND OLD.cancelled_at IS NULL THEN RETURN NEW; END IF;
  END IF;
  SELECT * INTO room FROM reservas.rooms WHERE id = NEW.room_id FOR SHARE;
  IF NOT FOUND THEN RETURN NEW; END IF; -- The foreign key reports a missing room.
  IF NOT room.active THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'bookings_room_inactive', MESSAGE = 'Inactive room';
  END IF;
  IF NEW.kind = 'booking' THEN
    local_start := NEW.starts_at AT TIME ZONE room.time_zone;
    local_end := NEW.ends_at AT TIME ZONE room.time_zone;
    IF local_start < date_trunc('day', local_start) + make_interval(mins => room.open_minute)
      OR local_end > date_trunc('day', local_start) + make_interval(mins => room.close_minute)
      OR local_end <= local_start THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'bookings_room_hours', MESSAGE = 'Outside room hours';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER check_booking_policy BEFORE INSERT OR UPDATE ON reservas.bookings
  FOR EACH ROW EXECUTE FUNCTION reservas.check_booking_policy();
--> statement-breakpoint
CREATE FUNCTION reservas.record_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  action_name text := lower(TG_OP);
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO reservas.audit (entity, entity_id, action, after)
      VALUES (TG_TABLE_NAME, NEW.id::text, action_name, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'bookings' AND (to_jsonb(NEW)->>'cancelled_at') IS NOT NULL
      AND (to_jsonb(OLD)->>'cancelled_at') IS NULL THEN action_name := 'cancel'; END IF;
    INSERT INTO reservas.audit (entity, entity_id, action, before, after)
      VALUES (TG_TABLE_NAME, NEW.id::text, action_name, to_jsonb(OLD), to_jsonb(NEW));
  ELSE
    INSERT INTO reservas.audit (entity, entity_id, action, before)
      VALUES (TG_TABLE_NAME, OLD.id::text, action_name, to_jsonb(OLD));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_booking AFTER INSERT OR UPDATE OR DELETE ON reservas.bookings
  FOR EACH ROW EXECUTE FUNCTION reservas.record_change();
--> statement-breakpoint
CREATE TRIGGER audit_room AFTER INSERT OR UPDATE OR DELETE ON reservas.rooms
  FOR EACH ROW EXECUTE FUNCTION reservas.record_change();
