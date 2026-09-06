-- ---------------------------------------------------------------------------
-- The hub moved off Bomso Junction
-- ---------------------------------------------------------------------------
--
-- The operation now runs out of Wagyingo Opal Hostel on the Ayeduase–Kotei
-- road, beside the Benab filling station. `LAUNDRY_HUB` in @freshfold/core is
-- the one place that decides where that is, and every distance, ETA and route
-- polyline is measured from it.
--
-- `riders.coords` carried its own copy of the old hub as a column default: a
-- courier who has never reported a GPS fix is "parked at the hub", and the
-- default is how that gets said in SQL. It was written before the move and
-- kept pointing at Bomso, so a newly rostered courier would appear two
-- kilometres from the building they collect from.
--
-- The coordinate here is an estimate — the midpoint of the Ayeduase and Kotei
-- anchors, which lands on the right stretch of road but was not surveyed to
-- the building. It matches the estimate in geo.ts and should be replaced in
-- both places at once when somebody drops a real pin on the forecourt.

alter table riders
  alter column coords set default '{"lat": 6.6625, "lng": -1.552}'::jsonb;

-- Couriers still sitting on the old default have never reported a fix, so the
-- value is a placeholder rather than an observation and is safe to move. A
-- courier who has reported one is left alone: that coordinate is where they
-- actually were, and overwriting it would be inventing a position.
update riders
   set coords = '{"lat": 6.6625, "lng": -1.552}'::jsonb
 where coords = '{"lat": 6.6852, "lng": -1.5815}'::jsonb;
