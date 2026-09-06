/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An order id, as somewhere you can go.
 *
 * A claim names the order it is about. An invoice line takes one as free text.
 * An inbox thread belongs to one. A settlement row *is* one. An audit entry
 * carries `orderId`. Every one of those was a bare string, so the way to get
 * from a claim to the job it concerns was to memorise six digits, change tab,
 * clear whatever filters were set, and type them into a search box — which is
 * also why the desk's five list panes each grew a different search.
 *
 * The id is the desk's join key and it now behaves like one. Pressing it opens
 * the Pipeline pane with that order expanded, and it is a real `<button>`
 * rather than a styled span, so it is tabbable and announced as a control.
 *
 * The handler lives in the shell because only the shell can change pane and
 * clear the filters that would otherwise hide the row. Rendered outside a
 * provider — which is how the panes' own tests and stories mount them — it
 * degrades to plain mono text rather than an inert button that looks pressable.
 */

import React, { createContext, useContext } from 'react';

type OpenOrder = (orderId: string) => void;

const OrderRefContext = createContext<OpenOrder | null>(null);

export function OrderRefProvider({
  onOpenOrder,
  children,
}: {
  onOpenOrder: OpenOrder;
  children: React.ReactNode;
}) {
  return <OrderRefContext.Provider value={onOpenOrder}>{children}</OrderRefContext.Provider>;
}

export function useOpenOrder(): OpenOrder | null {
  return useContext(OrderRefContext);
}

export default function OrderRef({
  id,
  className = '',
  children,
}: {
  id: string | undefined;
  className?: string;
  /** Defaults to the id. Pass a label for "Order 481920" phrasing. */
  children?: React.ReactNode;
}) {
  const open = useOpenOrder();
  const label = children ?? id;

  if (!id) return null;

  if (!open) {
    return <span className={`font-mono tabular-nums ${className}`}>{label}</span>;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        // These sit inside expandable rows and table cells that are themselves
        // click targets. Following the reference should not also toggle the row
        // it was read from.
        event.stopPropagation();
        open(id);
      }}
      title={`Open order ${id} in the pipeline`}
      className={`cursor-pointer rounded font-mono tabular-nums text-admin-accent underline decoration-admin-accent/30 underline-offset-2 transition-colors hover:decoration-admin-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/60 ${className}`}
    >
      {label}
    </button>
  );
}
