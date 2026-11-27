// Data shapes shared by the app and the Worker. All times are UTC ISO strings
// in the exact format Date.prototype.toISOString() produces, so they sort as text.

export type ListId = 'work' | 'personal' | 'groceries';
export const LISTS: readonly ListId[] = ['work', 'personal', 'groceries'];
export const LIST_NAMES: Record<ListId, string> = { work: 'Work', personal: 'Personal', groceries: 'Groceries' };

export type ItemStatus = 'open' | 'done' | 'archived';
export type CaptureSource = 'typed' | 'share';
/** Server-owned: where the capture is in LLM sorting. */
export type SortStatus = 'pending' | 'sorting' | 'sorted' | 'failed';

export interface Capture {
  id: string;
  /** Exactly what was typed or shared. Never changed, kept forever. */
  text: string;
  /** The moment of typing. Relative times are computed from this. */
  capturedAt: string;
  source: CaptureSource;
  sortStatus: SortStatus;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Grocery {
  canonicalName: string;
  displayName: string;
  quantity: number | null;
  section: string;
}

export interface Item {
  id: string;
  captureId: string | null;
  list: ListId;
  title: string;
  /** Notify at this time. */
  remindAt: string | null;
  /** Deadline: an ISO date (YYYY-MM-DD, local) or a UTC datetime. Shown, never notified. */
  dueAt: string | null;
  /** Server-owned: when the reminder was sent. Guards against sending twice. */
  notifiedAt: string | null;
  status: ItemStatus;
  /** Last time I did something with it; the fading clock counts from here. */
  touchedAt: string;
  grocery: Grocery | null;
  /** The sorter was not confident; it was filed under Personal. */
  unsorted: boolean;
  /** Made on the device by the quick parser; the LLM result may still replace it. */
  provisional: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SettingsDoc {
  value: import('./settings').Settings;
  updatedAt: string;
}

export interface SyncRequest {
  /** Server cursor from the previous sync; 0 the first time. */
  since: number;
  captures: Capture[];
  items: Item[];
  settings: SettingsDoc | null;
}

export interface SyncResponse {
  cursor: number;
  /** True when there is more to fetch: sync again with the new cursor. */
  more: boolean;
  captures: Capture[];
  items: Item[];
  settings: SettingsDoc | null;
  serverTime: string;
}

export const MAX_SYNC_ROWS = 200;
export const MAX_TEXT_LENGTH = 10_000;
