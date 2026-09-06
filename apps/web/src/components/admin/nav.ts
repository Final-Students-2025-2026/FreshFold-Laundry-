/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The rail, grouped by when you reach for it.
 *
 * ## What this replaces
 *
 * Ten flat entries in one undifferentiated list. Pipeline, Hub and Couriers —
 * the three panes a supervisor lives in during a shift — sat in the same
 * ungrouped column as Offers and Settings, which are opened a handful of times
 * a month. The grouping was already in the content; the navigation just did not
 * say it.
 *
 * ## The badge rule
 *
 * **A badge means "this needs you".** Nothing else earns one.
 *
 * The old rail put a figure beside four tabs and they meant four different
 * things: Pipeline showed *every* order, Patrons showed *every* account,
 * Settlement showed unpaid orders and Inbox showed threads somebody was waiting
 * on. Two were workload and two were inventory, and they were styled
 * identically apart from Settlement's amber — so the rail read as a to-do list
 * of which half was furniture, and the two figures that did mean something were
 * camouflaged by the two that did not.
 *
 * Inventory counts moved into the pane headers, where they describe the list
 * underneath them and are read as such. What is left on the rail is work: an
 * order nobody has been assigned to, a load waiting to be confirmed, a customer
 * waiting on a reply, a claim promised and not settled, a bill not collected.
 * Zero of something renders nothing at all, so a quiet rail is genuinely quiet.
 */

import {
  Bike,
  FileText,
  LayoutList,
  MessageSquare,
  Receipt,
  ScrollText,
  Settings,
  ShieldQuestion,
  TicketPercent,
  Users,
  WashingMachine,
} from 'lucide-react';

export type TabId =
  | 'pipeline'
  | 'hub'
  | 'roster'
  | 'inbox'
  | 'claims'
  | 'patrons'
  | 'financials'
  | 'billing'
  | 'offers'
  | 'audit'
  | 'settings';

export interface TabSpec {
  id: TabId;
  label: string;
  icon: typeof LayoutList;
  /** Shown under the pane title, and as the palette's second line. */
  blurb: string;
}

export interface NavGroup {
  id: 'floor' | 'people' | 'money' | 'desk';
  label: string;
  /** What this group is for, one line, in the rail. */
  gloss: string;
  tabs: TabSpec[];
}

export const NAV: NavGroup[] = [
  {
    id: 'floor',
    label: 'Floor',
    gloss: 'What is happening now',
    tabs: [
      {
        id: 'pipeline',
        label: 'Pipeline',
        icon: LayoutList,
        blurb: 'Every live order and where it has got to',
      },
      {
        id: 'hub',
        label: 'Hub',
        icon: WashingMachine,
        blurb: 'Confirm a wash and a press, and check a load in',
      },
      {
        id: 'roster',
        label: 'Couriers',
        icon: Bike,
        blurb: 'Hire a rider, assign a vehicle, set a shift',
      },
    ],
  },
  {
    id: 'people',
    label: 'People',
    gloss: 'Someone is waiting on you',
    tabs: [
      {
        id: 'inbox',
        label: 'Inbox',
        icon: MessageSquare,
        blurb: 'Every thread on the board, in the desk’s voice',
      },
      {
        id: 'claims',
        label: 'Claims',
        icon: ShieldQuestion,
        blurb: 'What went wrong, whose it is, and how it ended',
      },
      {
        id: 'patrons',
        label: 'Patrons',
        icon: Users,
        blurb: 'The customer directory, points and standing',
      },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    gloss: 'What is owed, in and out',
    tabs: [
      {
        id: 'financials',
        label: 'Settlement',
        icon: Receipt,
        blurb: 'What has been paid, what has not, and the receipt',
      },
      {
        id: 'billing',
        label: 'Billing',
        icon: FileText,
        blurb: 'Invoices for the businesses on account',
      },
      {
        id: 'offers',
        label: 'Offers',
        icon: TicketPercent,
        blurb: 'Promo codes, their caps and their minimums',
      },
    ],
  },
  {
    id: 'desk',
    label: 'Desk',
    gloss: 'Rarely, and deliberately',
    tabs: [
      {
        id: 'audit',
        label: 'Audit',
        icon: ScrollText,
        blurb: 'Everything anyone did to the ledger, and who',
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: Settings,
        blurb: 'This session and its credentials',
      },
    ],
  },
];

/** Every tab, flat, for lookups that do not care which group it is in. */
export const TABS: TabSpec[] = NAV.flatMap((group) => group.tabs);

export function tabSpec(id: TabId): TabSpec {
  return TABS.find((tab) => tab.id === id)!;
}

/** Which group a tab belongs to — the rail's breadcrumb reads it. */
export function groupOf(id: TabId): NavGroup {
  return NAV.find((group) => group.tabs.some((tab) => tab.id === id))!;
}
