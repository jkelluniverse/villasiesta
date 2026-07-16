-- Reservation reference (public, memo-safe): "VS-" + 4 chars from a 31-char
-- alphabet with no 0/O/1/I/L. Add nullable, backfill existing rows with unique
-- values, then enforce NOT NULL + UNIQUE.
ALTER TABLE "Booking" ADD COLUMN "reference" TEXT;

DO $$
DECLARE
  r RECORD;
  chars TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  ref TEXT;
  i INT;
BEGIN
  FOR r IN SELECT id FROM "Booking" WHERE "reference" IS NULL LOOP
    LOOP
      ref := 'VS-';
      FOR i IN 1..4 LOOP
        ref := ref || substr(chars, floor(random() * 31)::int + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Booking" WHERE "reference" = ref);
    END LOOP;
    UPDATE "Booking" SET "reference" = ref WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "Booking" ALTER COLUMN "reference" SET NOT NULL;
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");
