import type { Item } from './types';

interface Versioned {
  updatedAt: string;
}

/**
 * Last write wins, by updatedAt. On a tie the server copy wins unless the local
 * copy still has unsent changes.
 */
export function incomingWins(local: Versioned | undefined, incoming: Versioned, localDirty: boolean): boolean {
  if (!local) return true;
  if (incoming.updatedAt > local.updatedAt) return true;
  if (incoming.updatedAt < local.updatedAt) return false;
  return !localDirty;
}

/**
 * Merges a server item into the local one. notifiedAt belongs to the server, so
 * even when the local edit wins we keep the server's value (unless the reminder
 * time itself was changed locally, which re-arms the reminder).
 */
export function mergeItem(local: Item | undefined, incoming: Item, localDirty: boolean): { item: Item; dirty: boolean } {
  if (!local || incomingWins(local, incoming, localDirty)) return { item: incoming, dirty: false };
  const notifiedAt = local.remindAt === incoming.remindAt ? incoming.notifiedAt : null;
  return { item: { ...local, notifiedAt }, dirty: localDirty };
}
