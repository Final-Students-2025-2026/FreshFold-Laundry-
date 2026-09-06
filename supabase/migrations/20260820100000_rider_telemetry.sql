-- Rider telemetry: drop the battery nobody read, add the date that makes
-- "today" true.
--
-- `battery_level` was a constant. It was `100` in the seed, `100` at
-- provisioning, `100` in this column's own default, and the courier's phone
-- re-sent that same `100` on every telemetry tick for the life of the shift.
-- Nothing in any of the three apps ever rendered it, so there is no display to
-- replace and nothing is lost by removing it. Reading a real charge level needs
-- `expo-battery`, which this app does not depend on; adding the column back
-- alongside that dependency is the honest way to have this figure.
alter table riders drop column if exists battery_level;

-- `today_distance` said "today" and meant "ever". Nothing reset it — not a cron,
-- not the hub cycle, not sign-out — so it accumulated from the day a courier was
-- provisioned. `distance_date` is the reset: the phone stamps its own local
-- calendar date beside the figure, and a figure carrying any other date reads as
-- zero. Local rather than UTC, because a courier's day ends at midnight where
-- they are standing.
alter table riders add column if not exists distance_date text not null default '';

-- The figures already in the column were never a measurement of the ride. Each
-- one is a sum of straight-line hub-to-pickup distances frozen at booking time,
-- plus a flat 2.1 km the courier's own phone credited itself on every pickup
-- signature. The phone measures the real ride now, and an empty `distance_date`
-- already means no surface will show these as today's — this clears them so a
-- number built that way is not left in the column waiting to be believed.
--
-- `today_earnings` is deliberately left alone: those are real amounts from jobs
-- this server saw completed. Whether earnings should reset daily is a payroll
-- question rather than a display one.
update riders set today_distance = 0 where today_distance <> 0;
