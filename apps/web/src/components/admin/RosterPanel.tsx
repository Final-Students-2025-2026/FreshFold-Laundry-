/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Bike,
  CalendarClock,
  Copy,
  KeyRound,
  Loader2,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import {
  ApiError,
  PHONE_DIGITS,
  PHONE_LENGTH_MESSAGE,
  isCompletePhone,
  limitPhoneInput,
  onShift,
  type RiderShift,
  type RiderState,
} from '@freshfold/core';
import * as store from '../../services/store';
import { Badge, Banner, Button, EmptyState, Field, Input, Panel } from './ui';
import PaneHeader, { ResourceBanner } from './PaneHeader';
import type { DeskResource } from './useDeskResource';
import { useToast } from '../ui/Toast';

/**
 * The courier roster.
 *
 * Riders are hired, not signed up, so this is where one comes into existence.
 * The supervisor enters the details and the server assigns the employee ID —
 * it is what the courier signs in with, so a mistyped one is a courier locked
 * out of the app on their first morning.
 *
 * The vehicle and its plate are entered here too. They belong to FreshFold
 * rather than to whoever is riding them today, and the customer is shown both
 * at the door — a plate the company never checked is not proof of anything.
 * The rider app displays them read-only.
 *
 * The supervisor never types a PIN either: the server generates it, shows it
 * here once, and hashes it immediately. That is deliberate — a credential the
 * supervisor chose is one they can guess later, and under time pressure the
 * choice is always `1234`.
 */
/** "Mon 24 Aug, 17:00 — 21:00", collapsing the day when a block stays inside one. */
function shiftLabel(shift: RiderShift): string {
  const from = new Date(shift.startsAt);
  const to = new Date(shift.endsAt);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 'Unreadable shift';

  const day = from.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
  const start = from.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const end = to.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // An overnight block names both days, because "17:00 — 02:00" on one line
  // reads as a shift that ran backwards.
  const sameDay = from.toDateString() === to.toDateString();
  const endDay = to.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });

  return sameDay ? `${day}, ${start} — ${end}` : `${day}, ${start} — ${endDay}, ${end}`;
}

export default function RosterPanel({ riders }: { riders: DeskResource<RiderState[]> }) {
  const toast = useToast();

  /**
   * The roster comes from the shell.
   *
   * Two other things need it — the Pipeline's "call the courier" control, which
   * joins a phone number in by rider id, and the palette's plate search — and
   * this pane used to fetch its own copy on mount into private `loading` and
   * `error` state. The rota below is still read here, because nothing outside
   * this pane asks about shifts.
   */
  const list = riders.data;
  const loading = riders.loading;
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [creating, setCreating] = useState(false);

  /**
   * The rota, keyed by courier.
   *
   * Loaded for the whole fleet in one call rather than per row: `GET
   * /riders/shifts` answers a window across everybody, and one request beats a
   * request per courier on a roster of twenty.
   *
   * It matters here rather than only on a planning screen because the accept
   * route now reads it: a courier with shifts on the roster who is not on one
   * cannot take a job. `active` says they are on the payroll and `isOnline` says
   * their phone is unlocked — somebody who finished at six and left the app open
   * in a drawer was both, and could take a collection nobody was going to make.
   */
  const [shifts, setShifts] = useState<Record<string, RiderShift[]>>({});
  /**
   * Why the rota is not on screen, when it is not.
   *
   * Held rather than swallowed. This read used to end in `.catch(() => [])`,
   * which is the right instinct — the roster must survive a rota that will not
   * load — applied in the one way that costs more than it saves: an empty rota
   * and a rota nobody could read rendered identically. Every courier showed
   * `Rota (0)`, "On shift now" and "Not signed in" both read a confident zero,
   * and the pane asserted that nobody was rostered to a supervisor who had no
   * way of knowing the question had gone unanswered. That is how a 401 on
   * `GET /riders/shifts` sat unnoticed: the numbers were wrong in the direction
   * that looks like a quiet day.
   *
   * Null means the last read succeeded. A string is shown, and every figure
   * derived from the rota stops claiming a number.
   */
  const [rotaError, setRotaError] = useState<string | null>(null);
  /** The courier whose rota is open, and the block being drafted for them. */
  const [rostering, setRostering] = useState<string | null>(null);
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const [shiftNote, setShiftNote] = useState('');
  const [savingShift, setSavingShift] = useState(false);

  /** The courier whose vehicle is being reassigned, and to what. */
  const [reassigning, setReassigning] = useState<RiderState | null>(null);
  const [newVehicle, setNewVehicle] = useState('');
  const [newPlate, setNewPlate] = useState('');
  const [savingVehicle, setSavingVehicle] = useState(false);

  /** The one moment this PIN is readable. Cleared as soon as it is dismissed. */
  const [issued, setIssued] = useState<{ rider: RiderState; pin: string } | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * The rota, on its own read.
   *
   * Separate from the roster because only this pane wants it, and because a
   * rota that will not load must not take the roster down with it — hiring a
   * courier is the more urgent of the two jobs here and does not need shifts to
   * work. `riders.refresh()` and this are called together wherever both could
   * have changed.
   */
  const loadShifts = useCallback(async () => {
    const token = store.readAdminToken();
    if (!token) {
      setRotaError('This desk is not signed in, so the rota could not be read.');
      return;
    }

    try {
      /**
       * The rota alongside the roster, from a week back to a fortnight ahead.
       *
       * Backwards as well as forwards because the pane is where somebody
       * corrects a block they entered wrong yesterday, and a list that started
       * at "now" would hide exactly the entry they came to delete.
       */
      const rota = await store.api.rosterShifts(token, {
        from: new Date(Date.now() - 7 * 86_400_000).toISOString(),
        to: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      });

      const byRider: Record<string, RiderShift[]> = {};
      for (const shift of rota) {
        (byRider[shift.riderId] ??= []).push(shift);
      }
      setShifts(byRider);
      setRotaError(null);
    } catch (err) {
      /*
        Caught here and not thrown on, so the roster and the hire form stay
        usable — that much of the old `.catch` was right. What changes is that
        the failure is now recorded instead of being spent on an empty object:
        the banner says the rota is missing, and the figures drawn from it say
        they do not know rather than saying zero.
      */
      setRotaError(
        err instanceof ApiError
          ? err.message
          : 'The rota could not be read from the dispatch server.',
      );
    }
  }, []);

  /** Both halves, for the handlers that could have changed either. */
  const reload = useCallback(() => {
    riders.refresh();
    void loadShifts();
  }, [riders, loadShifts]);

  /**
   * Rosters a block.
   *
   * The two fields are `datetime-local`, which yields a string with no zone on
   * it — `new Date()` reads that in the browser's own zone, which is the right
   * reading: a supervisor typing 18:00 means six in the evening where they are
   * standing, and the server stores the instant that resolves to.
   */
  const addShift = async (riderId: string, event: React.FormEvent) => {
    event.preventDefault();

    const token = store.readAdminToken();
    if (!token) return;

    setSavingShift(true);
    try {
      await store.api.createShift(
        riderId,
        {
          startsAt: new Date(shiftStart).toISOString(),
          endsAt: new Date(shiftEnd).toISOString(),
          note: shiftNote.trim() || undefined,
        },
        token,
      );

      setShiftStart('');
      setShiftEnd('');
      setShiftNote('');
      reload();
    } catch (err) {
      // The server's sentence: "that overlaps a shift this courier is already
      // rostered for" is more use than anything this pane could invent.
      setError(err instanceof ApiError ? err.message : 'That shift could not be rostered.');
    } finally {
      setSavingShift(false);
    }
  };

  const removeShift = async (shiftId: string) => {
    const token = store.readAdminToken();
    if (!token) return;

    try {
      await store.api.deleteShift(shiftId, token);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That shift could not be removed.');
    }
  };

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  const addCourier = async (event: React.FormEvent) => {
    event.preventDefault();

    const token = store.readAdminToken();
    if (!token) return;

    if (!phone.trim()) {
      setError('A phone number is required.');
      return;
    }

    if (!isCompletePhone(phone)) {
      setError(PHONE_LENGTH_MESSAGE);
      return;
    }

    if (!vehicle.trim() || !vehiclePlate.trim()) {
      setError('Assign a vehicle and its plate — the customer is shown both at the door.');
      return;
    }

    setError('');
    setCreating(true);

    try {
      const result = await store.api.createRider(
        {
          name: name.trim(),
          phone: phone.trim(),
          vehicle: vehicle.trim(),
          vehiclePlate: vehiclePlate.trim(),
        },
        token
      );

      setIssued({ rider: result.rider, pin: result.temporaryPin });
      setName('');
      setPhone('');
      setVehicle('');
      setVehiclePlate('');
      setCopied(false);
      reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not add that courier.'
      );
    } finally {
      setCreating(false);
    }
  };

  const openReassign = (rider: RiderState) => {
    setReassigning(rider);
    setNewVehicle(rider.vehicle);
    setNewPlate(rider.vehiclePlate);
    setError('');
  };

  const saveVehicle = async (event: React.FormEvent) => {
    event.preventDefault();

    const token = store.readAdminToken();
    if (!token || !reassigning) return;

    if (!newVehicle.trim() || !newPlate.trim()) {
      setError('A vehicle and its plate number are both required.');
      return;
    }

    setSavingVehicle(true);

    try {
      await store.api.setRiderVehicle(
        reassigning.id,
        { vehicle: newVehicle.trim(), vehiclePlate: newPlate.trim() },
        token
      );
      setReassigning(null);
      setError('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reassign that vehicle.');
    } finally {
      setSavingVehicle(false);
    }
  };

  const setActive = async (rider: RiderState, active: boolean) => {
    const token = store.readAdminToken();
    if (!token) return;

    const verb = active ? 'reinstate' : 'remove';
    if (!window.confirm(`Are you sure you want to ${verb} ${rider.employeeId}?`)) return;

    try {
      await store.api.setRiderActive(rider.id, active, token);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${verb} that courier.`);
    }
  };

  /**
   * Who could actually take a job right now.
   *
   * `active` says they are on the payroll and `isOnline` says their phone is
   * unlocked; neither is the question. `onShift` is — somebody who finished at
   * six and left the app open in a drawer is both active and online, and is not
   * going to make a collection.
   */
  const onShiftNow = list.filter((rider) => onShift(shifts[rider.id] ?? [])).length;

  /**
   * Rostered but not signed in.
   *
   * The one figure here worth acting on: somebody is due on the road and their
   * phone has not opened the app. Neither half alone says that — a courier
   * signed in off-shift cannot take a job either, and a courier on shift with a
   * locked phone is the collection nobody is going to make.
   */
  const missing = list.filter(
    (rider) => onShift(shifts[rider.id] ?? []) && !rider.isOnline,
  ).length;

  return (
    <div className="space-y-4">
      <PaneHeader
        stats={[
          { label: 'On the roster', value: list.length },
          /*
            Both of these are read off the rota, so neither can answer while the
            rota is missing. An em dash rather than a zero: "nobody is on shift"
            and "we could not find out who is" are different facts, and the one
            that reads as a quiet afternoon is the wrong one to guess.
          */
          {
            label: 'On shift now',
            value: rotaError ? '—' : onShiftNow,
            tone: rotaError ? 'neutral' : onShiftNow > 0 ? 'ok' : 'warn',
            hint: rotaError ? 'rota unavailable' : 'can take a job',
          },
          {
            label: 'Not signed in',
            value: rotaError ? '—' : missing,
            tone: rotaError ? 'neutral' : missing > 0 ? 'warn' : 'ok',
            hint: rotaError ? 'rota unavailable' : 'though on shift',
          },
        ]}
        freshness={riders}
        banner={
          <>
            <ResourceBanner error={riders.error} refresh={riders.refresh} />
            {/*
              Warn rather than danger, and separate from the roster's own
              banner: the roster is fine and the pane's most urgent job — hiring
              a courier — still works. It is the rota that is missing, and it
              retries on its own read rather than the shell's.
            */}
            {rotaError && (
              <Banner tone="warn" onRetry={() => void loadShifts()}>
                {rotaError} The roster below is current; the shift figures and each courier’s rota
                are not being shown.
              </Banner>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start">
      <div className="space-y-4">
        {/* The temporary PIN, shown exactly once. Gold here is not decoration:
            it is the one block on the desk that will never be readable again. */}
        {issued && (
          <div className="admin-card rounded-2xl border border-admin-accent/40 bg-admin-accent/[0.07] p-4">
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-admin-accent" />
              <h3 className="text-[13px] font-semibold text-admin-fg">
                Sign-in details for {issued.rider.name || 'the new courier'}
              </h3>
            </div>

            <p className="text-[12px] leading-relaxed text-admin-fg-2">
              Give both of these to {issued.rider.name || 'the courier'} in person or by phone.{' '}
              <span className="text-admin-accent">
                The PIN will not be shown again — it is already hashed.
              </span>{' '}
              It expires in 48 hours, and they must replace it the first time they sign in.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <span className="mb-1 block text-[11px] text-admin-fg-3">Employee ID</span>
                <span className="block rounded-md border border-admin-line bg-admin-bg px-3 py-2 text-center font-mono text-[15px] font-semibold tracking-widest text-admin-fg">
                  {issued.rider.employeeId}
                </span>
              </div>
              <div>
                <span className="mb-1 block text-[11px] text-admin-fg-3">Temporary PIN</span>
                <span className="block rounded-md border border-admin-accent/50 bg-admin-accent px-3 py-2 text-center font-mono text-[15px] font-semibold tracking-[0.25em] text-black">
                  {issued.pin}
                </span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                icon={Copy}
                onClick={async () => {
                  /* Awaited, and the label only moves if it resolved.
                     `setCopied(true)` used to run beside an unawaited
                     `clipboard?.writeText()`, so the button said "Copied" on a
                     browser with no clipboard API and on a write the browser
                     refused because the document was not focused — and a
                     supervisor then read a rider a PIN off an empty paste. */
                  try {
                    if (!navigator.clipboard) throw new Error('no clipboard');
                    await navigator.clipboard.writeText(
                      `${issued.rider.employeeId} / ${issued.pin}`
                    );
                    setCopied(true);
                    toast('Sign-in and PIN copied.');
                  } catch {
                    toast('Could not reach the clipboard — read the PIN off the screen.', 'bad');
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy both'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
                I have passed it on
              </Button>
            </div>
          </div>
        )}

        <Panel
          title="Add a courier"
          description="The server assigns the ID and PIN once you save."
          bodyClassName="p-4"
        >
          <form onSubmit={addCourier} className="space-y-3">
            <Field label="Full name" hint="Optional — the courier sets it on first sign-in.">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Kwame Mensah"
              />
            </Field>

            <Field label="Phone">
              <Input
                value={phone}
                onChange={(event) => setPhone(limitPhoneInput(event.target.value))}
                inputMode="numeric"
                maxLength={PHONE_DIGITS}
                placeholder={`${PHONE_DIGITS} digits — e.g. 0244000000`}
              />
            </Field>

            <Field label="Vehicle">
              <Input
                value={vehicle}
                onChange={(event) => setVehicle(event.target.value)}
                placeholder="e.g. Electric delivery scooter"
              />
            </Field>

            <Field label="Plate">
              <Input
                value={vehiclePlate}
                onChange={(event) => setVehiclePlate(event.target.value.toUpperCase())}
                placeholder="e.g. AS-3012-26"
                className="[&_input]:font-mono [&_input]:uppercase"
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              disabled={creating}
              icon={creating ? Loader2 : UserPlus}
              className={`w-full ${creating ? '[&_svg]:animate-spin' : ''}`}
            >
              {creating ? 'Issuing…' : 'Add courier and issue credentials'}
            </Button>
          </form>

          <p className="mt-3 border-t border-admin-line pt-3 text-[11px] leading-relaxed text-admin-fg-3">
            The vehicle and plate are company records, so they are set here rather than by the
            courier; the rider app shows them read-only. Dispatch will not let a courier accept a
            job until they have entered their name.
          </p>
        </Panel>

        {!!error && (
          <div className="flex items-start gap-2 rounded-2xl border border-admin-danger/30 bg-admin-danger/10 p-3">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-admin-danger" />
            <p className="text-[12px] text-admin-danger">{error}</p>
          </div>
        )}
      </div>

      <Panel
        title="On the roster"
        description="Removing a courier keeps their delivery history and ends their sessions immediately."
        actions={<Badge mono>{list.length}</Badge>}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-admin-fg-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading the roster…
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Bike}
            title="Nobody on the roster yet"
            detail="Add your first courier with the form beside this panel."
          />
        ) : (
          <div className="divide-y divide-admin-line">
            {list.map((rider) => (
              <div key={rider.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-admin-fg">
                        {rider.name || (
                          <span className="italic text-admin-fg-3">Awaiting first sign-in</span>
                        )}
                      </span>
                      <span className="font-mono text-[11px] text-admin-fg-3">
                        {rider.employeeId}
                      </span>
                      {rider.isOnline && (
                        <Badge tone="ok" dot>
                          Online
                        </Badge>
                      )}
                      {rider.mustChangePin && <Badge tone="warn">PIN not changed</Badge>}
                      {/*
                        Whether they are actually working, which `Online` does
                        not say — that is only whether the app is open. A courier
                        with blocks on the rota who is not inside one cannot
                        accept a job.
                      */}
                      {(shifts[rider.id]?.length ?? 0) > 0 && (
                        <Badge tone={onShift(shifts[rider.id] ?? []) ? 'ok' : 'neutral'}>
                          {onShift(shifts[rider.id] ?? []) ? 'On shift' : 'Off shift'}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-admin-fg-3">
                      <span className="font-mono">{rider.phone}</span> ·{' '}
                      {rider.vehiclePlate ? (
                        <>
                          {rider.vehicle}{' '}
                          <span className="font-mono text-admin-fg-2">{rider.vehiclePlate}</span>
                        </>
                      ) : (
                        <span className="text-admin-warn">no vehicle assigned</span>
                      )}{' '}
                      · {rider.completedCount} delivered
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      icon={CalendarClock}
                      onClick={() =>
                        setRostering((current) => (current === rider.id ? null : rider.id))
                      }
                      title={
                        rotaError
                          ? `The rota could not be read, so this count is unknown`
                          : `Rota for ${rider.employeeId}`
                      }
                    >
                      {/* Not "(0)" when the answer never arrived — see `rotaError`. */}
                      Rota ({rotaError ? '—' : (shifts[rider.id]?.length ?? 0)})
                    </Button>
                    <Button
                      size="sm"
                      icon={Bike}
                      onClick={() => openReassign(rider)}
                      title={`Reassign the vehicle ${rider.employeeId} rides`}
                    >
                      {rider.vehiclePlate ? 'Vehicle' : 'Assign vehicle'}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={UserMinus}
                      onClick={() => void setActive(rider, false)}
                      title={`Remove ${rider.employeeId} from the roster`}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                {reassigning?.id === rider.id && (
                  <form
                    onSubmit={saveVehicle}
                    className="mt-3 space-y-2 rounded-xl border border-admin-line bg-admin-raised p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        autoFocus
                        value={newVehicle}
                        onChange={(event) => setNewVehicle(event.target.value)}
                        placeholder="Vehicle, e.g. Electric delivery scooter"
                      />
                      <Input
                        value={newPlate}
                        onChange={(event) => setNewPlate(event.target.value.toUpperCase())}
                        placeholder="Plate, e.g. AS-3012-26"
                        className="[&_input]:font-mono [&_input]:uppercase"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="primary" type="submit" disabled={savingVehicle}>
                        {savingVehicle ? 'Saving…' : 'Save vehicle'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReassigning(null)}>
                        Cancel
                      </Button>
                      <span className="text-[11px] text-admin-fg-3">
                        The courier sees this at once; the customer sees it at the door.
                      </span>
                    </div>
                  </form>
                )}

                {rostering === rider.id && (
                  <div className="mt-3 space-y-2 rounded-xl border border-admin-line bg-admin-raised p-3">
                    {/*
                      "Nothing rostered" is a claim about this courier, so it is
                      only made once the rota has actually been read. Otherwise
                      the drawer would answer a question it never got back.
                    */}
                    {rotaError ? (
                      <p className="text-[11px] text-admin-warn">
                        This courier’s rota could not be read, so nothing is listed here. The form
                        below still works — a block added now will appear once the rota loads.
                      </p>
                    ) : (shifts[rider.id] ?? []).length === 0 ? (
                      <p className="text-[11px] text-admin-fg-3">
                        Nothing rostered. A courier with no shifts at all can still accept work —
                        the rota only starts holding them to it once there is one.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {(shifts[rider.id] ?? []).map((shift) => (
                          <li
                            key={shift.id}
                            className="flex items-center justify-between gap-3 rounded-lg bg-admin-panel px-3 py-1.5"
                          >
                            <span className="min-w-0 text-[11px] text-admin-fg-2">
                              <span className="font-mono">{shiftLabel(shift)}</span>
                              {shift.note && (
                                <span className="text-admin-fg-3"> · {shift.note}</span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => void removeShift(shift.id)}
                              className="rounded-full p-1 text-admin-fg-3 transition-colors hover:text-admin-danger"
                              aria-label="Remove shift"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <form
                      onSubmit={(event) => void addShift(rider.id, event)}
                      className="space-y-2 border-t border-admin-line pt-2"
                    >
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Input
                          type="datetime-local"
                          value={shiftStart}
                          onChange={(event) => setShiftStart(event.target.value)}
                        />
                        <Input
                          type="datetime-local"
                          value={shiftEnd}
                          onChange={(event) => setShiftEnd(event.target.value)}
                        />
                        <Input
                          value={shiftNote}
                          onChange={(event) => setShiftNote(event.target.value)}
                          placeholder="Evening round"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        type="submit"
                        disabled={savingShift || !shiftStart || !shiftEnd}
                      >
                        {savingShift ? 'Rostering…' : 'Add shift'}
                      </Button>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
      </div>
    </div>
  );
}
