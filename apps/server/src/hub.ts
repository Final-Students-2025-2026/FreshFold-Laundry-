/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
import { toBookingStatus, type JobStatus } from '@freshfold/core';
import { recordAudit, SYSTEM_ACTOR } from './audit';
import { transition } from './routes/orders';
import { store } from './store';

/**
 * The hub's fallback clock.
 *
 * The three points where the bags physically change hands are confirmed by a
 * person — the courier scans the customer's collection code at the door, types
 * the desk's code at the hub, takes the customer's code back at the end — and
 * the two stages between the middle two are confirmed from the desk's Hub tab:
 * somebody says this load is washed, and somebody says this load is pressed and
 * folded. That is the design. This file is what runs when nobody has said
 * either, and what it does is advance the stage on elapsed time.
 *
 * Which is not the same act, and the trail records it as a different one. A
 * timer moving In Care to Ironing & Folding tells the customer their laundry is
 * being pressed on the evidence that two minutes passed; every advance it makes
 * is filed against `system` in `audit_events`, so the answer to "who confirmed
 * this load" is either a supervisor's name or the plain admission that nobody
 * did. And in production the sweep does not run at all unless an operator has
 * set a dwell — see `startHubCycle` below.
 *
 * It exists because the alternative during development is worse. Without it
 * `npm run dev` cannot show a job going round once, and the two stages would
 * need a second person at a second screen to demonstrate anything.
 *
 * The sweep used to run on the courier's phone, as a `setTimeout` in the rider
 * app's store. That made the laundry's progress a property of one device being
 * awake: a courier who closed the app, lost signal or ended their shift after
 * dropping bags off left the job at In Care permanently, with no path out of it
 * except a supervisor noticing and moving it by hand. It also meant the phone
 * stamped its own `riderId` on whatever it ripened, so a stage a supervisor had
 * set from the desk was walked on by whoever happened to be signed in. Both
 * problems are the same problem — the wrong process owned the clock.
 *
 * Every advance, whether a person or this timer made it, goes through the same
 * `transition` a courier's tap does, so the customer message, the timeline and
 * the courier's "ready for delivery" notification read identically whichever
 * moved it. The only difference is whose name is on the record.
 *
 * `dotenv.config()` runs here for the reason it runs in `./db`: imports are
 * evaluated before any statement in `index.ts`, so a module that reads
 * `process.env` at load has to load the file itself.
 */

dotenv.config();

/**
 * Whether this is somebody's laundry or somebody's laptop.
 *
 * Read once, at module load, for the reason `./seed` reads it once: it decides
 * whether a behaviour exists rather than how it performs, and a value that
 * changed under a running process would mean two instances of one deployment
 * disagreeing about whether the laundry advances itself.
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** The stages the hub owns, and what each one ripens into. */
const NEXT_STAGE = {
  dropped_off: 'processing',
  processing: 'ready_for_delivery',
} as const satisfies Partial<Record<JobStatus, JobStatus>>;

type HubStage = keyof typeof NEXT_STAGE;

/**
 * How long each stage is given, in minutes, before the sweep advances it.
 *
 * Two minutes because a development dwell has to be short enough to watch a job
 * go round once. It is not an estimate of how long a wash takes and nothing
 * should read it as one — the Hub tab is where a real dwell is decided, by the
 * person who knows the load is done. Set `HUB_WASH_MINUTES` and
 * `HUB_FINISH_MINUTES` to override, and see `startHubCycle` for when this
 * applies at all.
 */
const DEFAULT_DWELL_MINUTES = 2;

/** How often the sweep looks. Finer than this buys nothing a poll can see. */
const TICK_MS = 15_000;

/**
 * Minutes from the environment, as milliseconds.
 *
 * Fractions are allowed and deliberate — `0.1` is six seconds, which is what a
 * demo wants. Anything unparseable or negative falls back rather than throwing:
 * a typo in an optional tuning variable should not stop the server booting, and
 * the warning says which variable to look at.
 */
function dwellMs(variable: string): number {
  const raw = process.env[variable];
  if (!raw?.trim()) return DEFAULT_DWELL_MINUTES * 60_000;

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    console.warn(
      `[hub] ${variable}="${raw}" is not a number of minutes. ` +
        `Falling back to ${DEFAULT_DWELL_MINUTES}.`
    );
    return DEFAULT_DWELL_MINUTES * 60_000;
  }

  return minutes * 60_000;
}

/** The instant a job must have entered each stage before to be due out of it. */
interface Cutoff {
  droppedOff: string;
  processing: string;
}

/** How long each of the two hub stages is given, in milliseconds. */
interface Dwell {
  wash: number;
  finish: number;
}

function cutoffFor(dwell: Dwell): Cutoff {
  const now = Date.now();
  return {
    droppedOff: new Date(now - dwell.wash).toISOString(),
    processing: new Date(now - dwell.finish).toISOString(),
  };
}

/** "2" or "0.10" — enough to tell a demo dwell from a plausible one. */
function minutesLabel(ms: number): string {
  const minutes = ms / 60_000;
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(2);
}

/**
 * Moves one job on, if it is still where the sweep found it.
 *
 * The status and the clock are both re-checked under the row lock. Between the
 * sweep's read and this transaction a supervisor may have confirmed the stage
 * from the Hub tab, a courier may have collected it, or a second instance of
 * this server may have run the same sweep — and in all three cases `updated_at`
 * has moved forward, so the job is no longer due and this call does nothing.
 * That is what keeps the sweep safe to run in more than one process, and what
 * stops it walking on a confirmation somebody has just made.
 */
async function ripen(id: string, cutoff: Cutoff, dwell: Dwell): Promise<void> {
  await store.tx(async (t) => {
    const job = await t.jobs.find(id, { lock: true });
    if (!job) return;

    const next = NEXT_STAGE[job.status as HubStage];
    if (!next) return;

    const washing = job.status === 'dropped_off';
    const due = washing ? cutoff.droppedOff : cutoff.processing;
    if (Date.parse(job.updatedAt) > Date.parse(due)) return;

    const updated = await transition(t, job, { status: next });

    /**
     * Nobody confirmed this, and the trail says so.
     *
     * The customer has just been told their laundry moved on, and the only thing
     * that actually happened is that a clock passed a number. Recorded as the
     * system's doing rather than left silent so a supervisor asking "who said
     * this load was washed" gets the true answer — that nobody did — instead of
     * an entry that looks like somebody's.
     */
    await recordAudit(t, {
      ...SYSTEM_ACTOR,
      action: 'Stage advanced on a timer',
      details:
        `Moved ${updated.reference} from ${toBookingStatus(job.status)} to ` +
        `${toBookingStatus(updated.status)} because its ` +
        `${minutesLabel(washing ? dwell.wash : dwell.finish)}-minute dwell expired. ` +
        'Nobody confirmed the work.',
      type: 'system',
      orderId: updated.id,
      subject: updated.customer.email,
    });
  });
}

/**
 * One pass over everything the hub has finished with.
 *
 * Jobs are ripened one at a time rather than in one statement so each gets its
 * own transaction: a job that fails to move — a lock timeout, a row that
 * vanished — should not take the rest of the sweep down with it, and the next
 * tick is fifteen seconds away.
 */
async function sweep(dwell: Dwell): Promise<void> {
  const cutoff = cutoffFor(dwell);
  const due = await store.jobs.hubDue(cutoff);

  for (const job of due) {
    try {
      await ripen(job.id, cutoff, dwell);
    } catch (error) {
      console.error(`[hub] could not advance ${job.reference}:`, error);
    }
  }
}

/**
 * Starts the cycle, if this deployment wants one. Returns the function that
 * stops it.
 *
 * Off in production unless somebody has set a dwell, on everywhere else. The
 * reasoning is the whole point of this file: a timer that advances stages is a
 * development convenience — it lets `npm run dev` show a job going round once
 * without three people and a press table — and in front of paying customers it
 * is a machine telling them their laundry is washed on no evidence. Setting
 * either variable is how an operator says they know that and want it anyway.
 *
 * Returns a callable no-op when it does not start, because `index.ts` calls the
 * stop function unconditionally on shutdown.
 *
 * The timer is unref'd so it is never the thing keeping the process alive —
 * the HTTP server is, and a shutdown should not have to wait out a tick.
 */
export function startHubCycle(): () => void {
  const configured =
    !!process.env.HUB_WASH_MINUTES?.trim() || !!process.env.HUB_FINISH_MINUTES?.trim();

  if (IS_PRODUCTION && !configured) {
    console.log(
      '[hub] cycle off. Stages advance when somebody confirms them from the ' +
        'desk’s Hub tab. Set HUB_WASH_MINUTES or HUB_FINISH_MINUTES to run the ' +
        'timed sweep anyway.'
    );
    return () => {};
  }

  const dwell: Dwell = {
    wash: dwellMs('HUB_WASH_MINUTES'),
    finish: dwellMs('HUB_FINISH_MINUTES'),
  };

  let running = false;

  const tick = async (): Promise<void> => {
    // A sweep that has not finished is not overtaken by the next one. Every
    // ripen takes a row lock, and two overlapping passes would queue behind
    // each other for no gain.
    if (running) return;
    running = true;
    try {
      await sweep(dwell);
    } catch (error) {
      console.error('[hub] sweep failed:', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();

  console.log(
    `[hub] timed sweep on, standing in for the Hub tab: In Care ` +
      `${minutesLabel(dwell.wash)}m → Ironing & Folding ${minutesLabel(dwell.finish)}m → ` +
      'Quality Check. Every advance is filed in the audit trail as the system’s.'
  );

  return () => clearInterval(timer);
}
