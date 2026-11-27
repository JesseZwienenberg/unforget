<script lang="ts">
  import { dueDate, formatDay, formatWhen, localDate } from '$shared/time';
  import { LIST_NAMES, type Item } from '$shared/types';
  import { app } from '../lib/app.svelte';
  import { groceryLabel } from '../lib/views';

  let { item, showList = false }: { item: Item; showList?: boolean } = $props();

  const today = $derived(localDate(app.now, app.timeZone));
  const remindLate = $derived(Boolean(item.remindAt && item.remindAt < app.now.toISOString()));
  const due = $derived(item.dueAt ? dueDate(item.dueAt, app.timeZone) : null);
  const dueLate = $derived(Boolean(due && due < today));
  const warning = $derived(app.notScheduled(item));
  const label = $derived(item.list === 'groceries' ? groceryLabel(item) : item.title);
</script>

<li>
  <button type="button" class="check" aria-label="Mark done: {label}" onclick={() => app.setDone(item.id, true)}>
    <span aria-hidden="true"></span>
  </button>
  <button type="button" class="body" onclick={() => app.edit(item.id)}>
    <span class="title">{label}</span>
    {#if warning}<span class="warning">⚠ {warning}</span>{/if}
    {#if item.remindAt || due || showList || item.unsorted}
      <span class="meta">
        {#if item.remindAt}<span class:late={remindLate}>⏰ {formatWhen(item.remindAt, app.timeZone, app.now)}</span>{/if}
        {#if due}<span class:late={dueLate}>due {formatDay(due, today)}</span>{/if}
        {#if showList}<span>{LIST_NAMES[item.list]}</span>{/if}
        {#if item.unsorted}<span>unsorted</span>{/if}
      </span>
    {/if}
  </button>
</li>

<style>
  li {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--line);
  }
  .check {
    flex: none;
    width: 3.25rem;
    min-height: 3.25rem;
    border: 0;
    background: none;
    display: grid;
    place-items: center;
  }
  .check span {
    width: 1.45rem;
    height: 1.45rem;
    border-radius: 50%;
    border: 2px solid var(--muted);
  }
  .check:active span {
    background: var(--accent);
    border-color: var(--accent);
  }
  .body {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0.7rem 1rem 0.7rem 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.15rem;
  }
  .title {
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.75rem;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .warning {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--warn);
  }
  .late {
    color: var(--bad);
    font-weight: 600;
  }
</style>
