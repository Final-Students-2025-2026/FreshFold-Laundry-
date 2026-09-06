import { useEffect, useState } from 'react';
import { LANDMARKS, SERVICE_SUBURBS } from '@freshfold/core';
import { Check, MapPin, Search } from 'lucide-react';
import { useIntent } from '../../intent';

interface AreaCheckProps {
  /** Opens the booking form, once the answer is yes. */
  onBook: () => void;
}

/**
 * "Do you come to my area?" — the question a local service gets asked before
 * any other, and the one this page could not answer without someone typing it
 * into the enquiry form and waiting.
 *
 * Answered from `@freshfold/core`: `SERVICE_SUBURBS` is the list of collection
 * zones the dispatch board groups jobs by, and `LANDMARKS` is the named places
 * inside them — the hostels and junctions people actually say when you ask
 * where they live. Both are the same tables the rider app routes from, so a yes
 * here is a yes the business can keep.
 *
 * Deliberately not `anchorForSuburb()`, which exists to centre a map and
 * therefore never fails: it falls back to the middle of campus for any input at
 * all. A coverage check that cannot say no is not a coverage check.
 */
type Result =
  | { kind: 'idle' }
  | { kind: 'covered'; suburb: string; via: string | null }
  | { kind: 'unknown'; query: string };

function look(query: string): Result {
  const needle = query.trim().toLowerCase();
  if (!needle) return { kind: 'idle' };

  // A named place first — "Evandy", "Katanga", "Kotei Town Square" — because
  // that is what someone types, and it resolves to the zone behind it.
  const landmark = LANDMARKS.find((place) => {
    const name = place.name.toLowerCase();
    return name.includes(needle) || needle.includes(name.split(' (')[0].toLowerCase());
  });
  if (landmark) return { kind: 'covered', suburb: landmark.suburb, via: landmark.name };

  const suburb = SERVICE_SUBURBS.find((zone) => {
    const name = zone.toLowerCase();
    return name.includes(needle) || needle.includes(name);
  });
  if (suburb) return { kind: 'covered', suburb, via: null };

  return { kind: 'unknown', query: query.trim() };
}

export default function AreaCheck({ onBook }: AreaCheckProps) {
  const { intent, note } = useIntent();
  const [query, setQuery] = useState(intent.suburb);
  const result = look(query);

  /**
   * A confirmed zone is remembered for the rest of the visit.
   *
   * This check was the page's clearest dead end: it answered the first question
   * a local service is ever asked, said yes, and then dropped the answer on the
   * floor — the visitor scrolled on and typed their area again into the booking
   * form ten minutes later. The form still derives the collection zone from the
   * pin and the address, which is the only way it can be trusted; what this
   * saves is the *asking*, and it is what lets the concierge and the booking
   * form open already knowing where they are.
   */
  const covered = result.kind === 'covered' ? result.suburb : '';

  useEffect(() => {
    if (covered) note({ suburb: covered });
  }, [covered, note]);

  return (
    <div className="rounded-xl border border-white/10 bg-brand-card p-6 sm:p-8">
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <h3 className="font-display text-[27px] font-medium leading-tight text-white">
            Do we collect from you?
          </h3>
          <p className="mt-2 max-w-[42ch] text-body text-brand-text-muted">
            Type your hall, hostel or area. We run across Ayeduase, Kotei, Bomso, Boadi, Deduako and
            KNUST campus.
          </p>
        </div>

        <div className="lg:col-span-6 lg:col-start-7">
          <label htmlFor="area-check" className="block text-[13px] font-medium text-brand-text-light">
            Where are you?
          </label>
          <div className="relative mt-2">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-text-muted"
            />
            <input
              id="area-check"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Evandy Hostel, Bomso, Katanga…"
              autoComplete="off"
              className="w-full rounded-md border border-white/15 bg-brand-charcoal py-3 pl-11 pr-4 text-[15px] text-white placeholder:text-brand-text-muted transition-colors duration-200 focus:border-brand-gold focus:outline-none"
            />
          </div>

          {/* One live region for every outcome, so the answer is announced
              rather than only drawn. */}
          <div aria-live="polite" className="mt-4 min-h-[3.25rem]">
            {result.kind === 'covered' && (
              <p className="panel-swap flex items-start gap-2.5 text-[15px] text-white">
                <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-sage-light" />
                <span>
                  Yes — we collect from{' '}
                  <strong className="font-semibold text-brand-sage-light">{result.suburb}</strong>.
                  {result.via ? ` ${result.via} is on the round.` : ''} Pickups from 07:00, and
                  delivery is free.
                </span>
              </p>
            )}
            {result.kind === 'unknown' && (
              <p className="panel-swap flex items-start gap-2.5 text-[15px] text-white">
                <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" />
                <span>
                  We do not have a round in “{result.query}” yet. Send us a message below and we
                  will tell you straight whether we can reach you.
                </span>
              </p>
            )}
          </div>

          {/* Where a yes goes. An answer with nothing to press is a fact; an
              answer with a booking behind it is the reason the check exists. */}
          {covered && (
            <button
              type="button"
              onClick={onBook}
              className="mb-5 w-full rounded-md bg-brand-gold px-6 py-3.5 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light sm:w-auto"
            >
              Book a pickup in {covered}
            </button>
          )}

          {/* The zones, as a row you can press. Someone who does not know what
              their area is called can find it here without typing. */}
          <div className="mt-1 flex flex-wrap gap-2">
            {SERVICE_SUBURBS.map((zone) => (
              <button
                key={zone}
                onClick={() => setQuery(zone)}
                className={`rounded-md border px-3 py-1.5 text-body transition-colors duration-200 ${
                  result.kind === 'covered' && result.suburb === zone
                    ? 'border-brand-sage-light bg-brand-sage text-white'
                    : 'border-white/15 text-brand-text-muted hover:border-white/30 hover:text-white'
                }`}
              >
                {zone}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
