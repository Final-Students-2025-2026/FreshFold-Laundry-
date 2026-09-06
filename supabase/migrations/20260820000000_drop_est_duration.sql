-- Drop the fabricated duration estimate from jobs written by an older build.
--
-- `JobDispatch.estDurationMins` was the straight-line distance from the hub to
-- the pickup divided by an assumed 18 km/h, frozen at booking time and
-- recomputed on every address edit. It is gone from the type, and every surface
-- that rendered it as an arrival time now reads a duration the routing engine
-- answered or shows the job's stage instead.
--
-- `dispatch` is a single jsonb column and the row mapper is a pass-through, so
-- no column changes: this only strips the key, so a row written before the
-- change does not keep a number nothing will ever read again. `distanceKm`
-- stays — that one is a real measurement.
update jobs
set dispatch = dispatch - 'estDurationMins'
where dispatch ? 'estDurationMins';
