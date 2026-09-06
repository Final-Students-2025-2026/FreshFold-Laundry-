-- Keepalive: a scheduled request that stops the dispatch server going to sleep.
--
-- Render's free plan spins a web service down after fifteen minutes with no
-- inbound request, and the cold start that follows takes around fifty seconds.
-- Vercel's proxy will not hold a rewrite that long, so it answers the browser
-- 502 while the server behind it is still booting perfectly well. The request
-- is lost; the service is not. That is what put `POST /admin/login failed (502)`
-- in front of a supervisor on a service that was working — see the note on
-- GATEWAY_MESSAGE in packages/core/src/client.ts, which is what stops the
-- browser reading the number out, and this file, which is what stops it
-- happening.
--
-- Why here, of all places. The obvious home is a scheduled GitHub Action, and
-- it is the wrong one: both repositories are private, Actions bills private
-- minutes rounded up to the minute, and a ping frequent enough to work costs
-- more per month than the paid Render plan it exists to avoid. Supabase runs
-- pg_cron on the free tier, this project already depends on it being up, and a
-- scheduler that is already paid for is the cheapest one there is.
--
-- The circularity is deliberate rather than tolerated: the database calls the
-- server, and the server's health check calls the database back. A ping that
-- cannot run because Postgres is down is a ping with nothing to keep awake.
--
-- To take it off, from the SQL editor:  select cron.unschedule('freshfold-keepalive');
do $$
begin
  -- pg_cron schedules it; pg_net is what lets Postgres make an outbound HTTP
  -- request at all. Both ship with Supabase and are enabled per project, so
  -- this is the line that turns them on for this one.
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  -- Dynamic, so the names in it are resolved when it runs rather than when this
  -- block is compiled. `cron` and `net` are created immediately above and do
  -- not exist yet at compile time on a database seeing this for the first time.
  --
  -- Every ten minutes, not every fifteen: fifteen is the deadline itself, and a
  -- scheduler that fires exactly on it races the thing it is trying to prevent.
  --
  -- Named, because the three-argument form of cron.schedule upserts on the
  -- name. Running this twice leaves one job rather than two.
  --
  -- Straight to Render rather than through the Vercel domain. The point is to
  -- reach the process that sleeps, and putting the proxy that returns the 502
  -- in the path of the request meant to prevent it is a way to be told the ping
  -- failed while it was working. The host is the one vercel.json rewrites to.
  --
  -- The timeout is generous for the same reason the client's is (see
  -- COLD_START_TIMEOUT_MS): if this ever does arrive at a sleeping service, it
  -- should stay on the line long enough to record what happened. Waking it does
  -- not depend on that — the connection alone is what Render's router acts on,
  -- so even a ping that times out has already done its job.
  execute $cron$
    select cron.schedule(
      'freshfold-keepalive',
      '*/10 * * * *',
      $req$select net.http_get(
        'https://freshfold-server.onrender.com/api/health',
        timeout_milliseconds => 60000
      )$req$
    )
  $cron$;

  raise notice '[keepalive] scheduled freshfold-keepalive every 10 minutes';
exception
  -- Never worth failing a deploy over.
  --
  -- This runs as Render's pre-deploy step, where a migration that exits non-zero
  -- aborts the release and leaves the old build serving — which is the right
  -- behaviour for a schema change that the new code needs, and the wrong one for
  -- a comfort. Creating an extension needs a privilege the pooled application
  -- role is not guaranteed to have, and the cost of not having it is cold
  -- starts, not an outage. So it says so and lets the deploy through, and the
  -- statements above can be pasted into the Supabase SQL editor by hand.
  --
  -- The handler is a subtransaction, so a failure here rolls back to this block
  -- and the migration still commits and records itself.
  when others then
    raise notice '[keepalive] not scheduled (%): run this file in the Supabase SQL editor', sqlerrm;
end $$;
