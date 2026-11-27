// The eval set: realistic captures with what we expect back. Run against the real
// model with the "Eval sorting" workflow; used to tune the prompt. Never run in CI.
//
// Every case is captured at the same moment: Thursday 26 November 2026, 14:03 in
// Amsterdam. Only the fields given in `expect` are checked.
import type { ListId } from '../shared/src/types';

export const CAPTURED_AT = '2026-11-26T13:03:00.000Z';

export interface ExpectedItem {
  list: ListId;
  /** Lowercase text the title must contain. */
  title?: string;
  /** Local "YYYY-MM-DD HH:MM", or null for "must have none". */
  remindAt?: string | null;
  /** "YYYY-MM-DD", or null for "must have none". */
  dueAt?: string | null;
  /** The local date that must appear as either the reminder or the deadline. */
  onDate?: string;
  /** Accepted canonical names. */
  canonical?: string[];
  section?: string[];
  quantity?: number | null;
  unsorted?: boolean;
}

export interface EvalCase {
  text: string;
  expect: ExpectedItem[];
}

const g = (title: string, canonical: string[], section: string[], quantity: number | null = null): ExpectedItem => ({
  list: 'groceries',
  title,
  canonical,
  section,
  quantity,
  remindAt: null,
  dueAt: null,
});

export const CASES: EvalCase[] = [
  // --- groceries: single, lists, quantities, mixed languages
  { text: 'ketchup', expect: [g('ketchup', ['ketchup'], ['Pantry'])] },
  { text: 'bananen', expect: [g('banan', ['banana'], ['Fruit & vegetables'])] },
  {
    text: 'kaas, yoghurt en 2 komkommers',
    expect: [g('kaas', ['cheese'], ['Cheese & deli']), g('yoghurt', ['yogurt', 'yoghurt'], ['Dairy & eggs']), g('komkommer', ['cucumber'], ['Fruit & vegetables'], 2)],
  },
  { text: 'wc eend en afwasmiddel', expect: [g('wc eend', ['toilet cleaner', 'wc eend', 'toilet duck'], ['Household']), g('afwasmiddel', ['dish soap', 'dishwashing liquid', 'washing-up liquid'], ['Household'])] },
  {
    text: 'tandpasta shampoo deodorant',
    expect: [g('tandpasta', ['toothpaste'], ['Personal care']), g('shampoo', ['shampoo'], ['Personal care']), g('deodorant', ['deodorant'], ['Personal care'])],
  },
  { text: 'g 3 blikken tomaten', expect: [{ list: 'groceries', title: 'tomaten', quantity: 3, section: ['Pantry'] }] },
  {
    text: "pak havermelk, coffee beans en 2 avocado's",
    expect: [
      { list: 'groceries', title: 'havermelk', canonical: ['oat milk'] },
      { list: 'groceries', title: 'coffee', canonical: ['coffee bean', 'coffee beans', 'coffee'] },
      g('avocado', ['avocado'], ['Fruit & vegetables'], 2),
    ],
  },
  {
    text: 'kip, rijst en doe ook maar chips',
    expect: [g('kip', ['chicken'], ['Meat & fish']), g('rijst', ['rice'], ['Pantry']), g('chips', ['chips', 'potato chips', 'crisps', 'chip', 'potato chip', 'crisp'], ['Snacks'])],
  },
  { text: 'paracetamol en pleisters', expect: [g('paracetamol', ['paracetamol', 'acetaminophen'], ['Personal care']), g('pleister', ['bandage', 'plaster', 'band-aid', 'adhesive bandage'], ['Personal care'])] },

  // --- reminders: explicit and vague times
  { text: 'morgen om 9 uur garage bellen', expect: [{ list: 'personal', title: 'garage bellen', remindAt: '2026-11-27 09:00', dueAt: null }] },
  { text: 'vanavond vuilnis buiten zetten', expect: [{ list: 'personal', title: 'vuilnis buiten zetten', remindAt: '2026-11-26 20:00', dueAt: null }] },
  { text: 'remind me tomorrow morning to email Sarah about the contract', expect: [{ list: 'work', title: 'email sarah', remindAt: '2026-11-27 07:45', dueAt: null }] },
  { text: 'dit weekend schuur opruimen', expect: [{ list: 'personal', title: 'schuur opruimen', remindAt: '2026-11-28 10:00' }] },
  { text: 'dinsdag 14:00 call met leverancier', expect: [{ list: 'work', title: 'call met leverancier', remindAt: '2026-12-01 14:00' }] },
  { text: 'half 4 Lisa ophalen van school', expect: [{ list: 'personal', title: 'lisa ophalen', remindAt: '2026-11-26 15:30' }] },
  { text: 'morgen half negen tandarts', expect: [{ list: 'personal', title: 'tandarts', remindAt: '2026-11-27 08:30' }] },
  { text: 'kwart voor 6 trein halen', expect: [{ list: 'personal', title: 'trein halen', remindAt: '2026-11-26 17:45' }] },
  { text: 'vrijdag kwart over 8 standup with the new team', expect: [{ list: 'work', title: 'standup', remindAt: '2026-11-27 08:15' }] },
  { text: 'at 7 pick up the pizza', expect: [{ list: 'personal', title: 'pizza', remindAt: '2026-11-26 19:00' }] },
  { text: 'zaterdag om 11 uur kapper', expect: [{ list: 'personal', title: 'kapper', remindAt: '2026-11-28 11:00' }] },
  { text: 'call the plumber tomorrow afternoon about de lekkage', expect: [{ list: 'personal', title: 'plumber', remindAt: '2026-11-27 13:00' }] },
  { text: 'vanmiddag om 4 uur tandarts', expect: [{ list: 'personal', title: 'tandarts', remindAt: '2026-11-26 16:00' }] },
  { text: 'volgende week dinsdag APK auto', expect: [{ list: 'personal', title: 'apk', remindAt: '2026-12-01 07:45' }] },
  { text: 'morgen oma bellen', expect: [{ list: 'personal', title: 'oma bellen', remindAt: '2026-11-27 07:45', dueAt: null }] },

  // --- relative times and prefixes (handled on the phone, must survive sorting)
  { text: 'over 20 minuten was uit de machine halen', expect: [{ list: 'personal', title: 'was uit de machine halen', remindAt: '2026-11-26 14:23' }] },
  { text: 'w over een uur Jan terugbellen', expect: [{ list: 'work', title: 'jan terugbellen', remindAt: '2026-11-26 15:03' }] },
  { text: 'p sportschool opzeggen', expect: [{ list: 'personal', title: 'sportschool opzeggen', remindAt: null, dueAt: null }] },

  // --- deadlines
  { text: 'voor vrijdag declaraties indienen', expect: [{ list: 'work', title: 'declaraties indienen', remindAt: null, dueAt: '2026-11-27' }] },
  { text: 'book flights to Lisbon by next Friday', expect: [{ list: 'personal', title: 'book flights to lisbon', remindAt: null, dueAt: '2026-12-04' }] },
  { text: 'huur overmaken uiterlijk de 30e', expect: [{ list: 'personal', title: 'huur overmaken', dueAt: '2026-11-30' }] },
  {
    text: 'kwartaalrapport afmaken deadline 1 december, herinner me maandagochtend',
    expect: [{ list: 'work', title: 'kwartaalrapport afmaken', remindAt: '2026-11-30 07:45', dueAt: '2026-12-01' }],
  },
  { text: 'review PR van Daan before lunch tomorrow', expect: [{ list: 'work', title: 'review pr van daan', onDate: '2026-11-27' }] },

  // --- splitting tasks, undated, unclear
  {
    text: 'sprint review slides maken en morgen 10:00 standup niet vergeten',
    expect: [
      { list: 'work', title: 'slides', remindAt: null },
      { list: 'work', title: 'standup', remindAt: '2026-11-27 10:00' },
    ],
  },
  { text: 'nieuwe serie kijken: Severance', expect: [{ list: 'personal', title: 'severance', remindAt: null, dueAt: null }] },
  { text: 'bellen en afspraak maken met de fysio', expect: [{ list: 'personal', title: 'fysio', remindAt: null, dueAt: null }] },
  { text: 'fgdh', expect: [{ list: 'personal', unsorted: true }] },
];
