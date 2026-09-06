import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin, Star } from 'lucide-react';
import type { PlaceDetail, PlaceSuggestion } from '@freshfold/core';
import * as store from '../services/store';

/**
 * The pickup address, with the map's help.
 *
 * Still a free-text field, and deliberately so — the room number is the half of
 * a KNUST address that no lookup service has ever heard of, and the courier
 * needs it. What the lookup adds is the other half: choosing "Evandy Hostel"
 * from the list puts the pin on Evandy Hostel, so the customer types their room
 * number onto an address that is already in the right place instead of dragging
 * a map two kilometres first.
 *
 * Typing past a suggestion is always allowed. The list narrows; it does not
 * decide.
 */

interface AddressAutocompleteProps {
  value: string;
  onChange: (next: string) => void;
  /** Fired when a suggestion is chosen, with the address and its coordinate. */
  onPlaceSelected: (detail: PlaceDetail) => void;
  placeholder?: string;
  className?: string;
  /**
   * Put on the text field itself, so a caller's `<label htmlFor>` reaches it.
   *
   * The input is several elements down from here, so without this every caller
   * writing a label beside this control was writing an orphaned one — the text
   * reads as a label and behaves as decoration, and clicking it focuses
   * nothing.
   */
  id?: string;
}

/** Long enough that the list is not rebuilt on every keystroke. */
const DEBOUNCE_MS = 250;

export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder,
  className,
  id,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  /**
   * Google bills a lookup as one search when the keystrokes and the final
   * detail call share a token, and as one autocomplete *per keystroke* when
   * they do not. Minted per lookup, retired on selection.
   */
  const sessionRef = useRef<string>(newSession());

  /**
   * Set while a selection is being applied, so the effect below does not
   * immediately re-open the list against the address it just filled in.
   */
  const justSelected = useRef(false);

  useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }

    const query = value.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const next = await store.api.searchPlaces(query, sessionRef.current);
        if (cancelled) return;
        setSuggestions(next);
        setOpen(next.length > 0);
        setHighlighted(-1);
      } catch {
        // Offline, rate-limited, or no key configured. The field is still a
        // text box and the pin can still be placed by hand.
        if (!cancelled) {
          setSuggestions([]);
          setOpen(false);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  // A click anywhere else is a decision not to pick from the list.
  useEffect(() => {
    if (!open) return;

    const onDocumentClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [open]);

  const choose = async (suggestion: PlaceSuggestion) => {
    justSelected.current = true;
    setOpen(false);
    setSuggestions([]);

    // A landmark already knows where it is; going to the server for it would
    // be a round trip to re-read a table we shipped.
    if (suggestion.source === 'landmark' && suggestion.coords) {
      onPlaceSelected({
        id: suggestion.id,
        address: suggestion.primary,
        coords: suggestion.coords,
      });
      return;
    }

    setBusy(true);
    try {
      const detail = await store.api.getPlace(suggestion.id, sessionRef.current);
      onPlaceSelected(detail);
    } catch {
      // The lookup failed after the customer picked a row. Take the text —
      // it is what they chose — and leave the pin to them.
      onChange(suggestion.primary);
    } finally {
      setBusy(false);
      // The session ends with the detail call, billed or not.
      sessionRef.current = newSession();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && highlighted >= 0) {
      // Only swallows Enter when a row is actually highlighted, so the form
      // still submits normally for somebody who ignored the list.
      event.preventDefault();
      void choose(suggestions[highlighted]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        id={id}
        type="text"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
      />

      {busy && (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-sage absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      )}

      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 bg-[#161616] border border-white/15 rounded-xl overflow-hidden shadow-2xl max-h-56 overflow-y-auto"
        >
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.id} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => void choose(suggestion)}
                className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors cursor-pointer ${
                  index === highlighted ? 'bg-white/10' : 'hover:bg-white/5'
                }`}
              >
                {suggestion.source === 'landmark' ? (
                  <Star className="w-3.5 h-3.5 text-brand-gold shrink-0 mt-0.5 fill-current" />
                ) : (
                  <MapPin className="w-3.5 h-3.5 text-stone-500 shrink-0 mt-0.5" />
                )}
                <span className="min-w-0">
                  <span className="block text-[11.5px] text-white font-semibold truncate">
                    {suggestion.primary}
                  </span>
                  {!!suggestion.secondary && (
                    <span className="block text-[10px] text-stone-400 truncate">
                      {suggestion.secondary}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function newSession(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
