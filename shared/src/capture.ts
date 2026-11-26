import { parseCapture } from './parse';
import type { Settings } from './settings';
import type { Capture, CaptureSource, Item } from './types';

/**
 * Turns typed text into a capture plus one provisional item, entirely on the
 * device. `now` is the moment of typing; relative times count from it.
 */
export function createCapture(
  text: string,
  source: CaptureSource,
  now: Date,
  settings: Settings,
  newId: () => string,
): { capture: Capture; item: Item } {
  const stamp = now.toISOString();
  const parsed = parseCapture(text, now, settings.prefixes);
  const capture: Capture = {
    id: newId(),
    text,
    capturedAt: stamp,
    source,
    sortStatus: 'pending',
    updatedAt: stamp,
    deletedAt: null,
  };
  const item: Item = {
    id: newId(),
    captureId: capture.id,
    list: parsed.list ?? 'personal',
    title: parsed.title,
    remindAt: parsed.remindAt,
    dueAt: null,
    notifiedAt: null,
    status: 'open',
    touchedAt: stamp,
    grocery: null,
    unsorted: false,
    provisional: true,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
  return { capture, item };
}
