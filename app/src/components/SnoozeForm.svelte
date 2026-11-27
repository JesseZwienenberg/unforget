<script lang="ts">
  import { resolveSnooze, snoozeLabel } from '$shared/snooze';
  import { formatWhen, fromInputValue, toInputValue } from '$shared/time';
  import type { Item } from '$shared/types';
  import { app } from '../lib/app.svelte';

  let { item }: { item: Item } = $props();

  const presets = $derived(
    app.settings.snoozePresets
      .map((id) => ({ id, label: snoozeLabel(id), at: resolveSnooze(id, app.now, app.settings) }))
      .filter((p) => p.at !== null),
  );

  let picking = $state(false);
  let custom = $state(toInputValue(new Date(app.now.getTime() + 2 * 3_600_000).toISOString(), app.timeZone));

  function setCustom(event: SubmitEvent) {
    event.preventDefault();
    const iso = fromInputValue(custom, app.timeZone);
    if (iso) void app.snooze(item.id, new Date(iso));
  }
</script>

<div class="snooze">
  <p class="title">{item.title}</p>
  {#if item.remindAt}<p class="muted">⏰ {formatWhen(item.remindAt, app.timeZone, app.now)}</p>{/if}

  <div class="options">
    {#each presets as preset (preset.id)}
      <button type="button" onclick={() => app.snooze(item.id, preset.id)}>
        <span>{preset.label}</span>
        <small>{preset.at ? formatWhen(preset.at.toISOString(), app.timeZone, app.now) : ''}</small>
      </button>
    {/each}
    {#if !picking}
      <button type="button" onclick={() => (picking = true)}><span>Pick a time</span></button>
    {/if}
  </div>

  {#if picking}
    <form onsubmit={setCustom}>
      <input type="datetime-local" bind:value={custom} aria-label="Remind me at" required />
      <button type="submit" class="primary">Set</button>
    </form>
  {/if}

  <button type="button" class="primary done" onclick={() => app.setDone(item.id, true)}>Done</button>
</div>

<style>
  .snooze {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  p {
    margin: 0;
  }
  .title {
    font-size: 1.15rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--muted);
    font-size: 0.9rem;
    margin-top: -0.5rem;
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  button {
    min-height: 3.25rem;
    padding: 0 1rem;
    border-radius: 0.7rem;
    border: 1.5px solid var(--line);
    background: none;
    color: inherit;
    font: inherit;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  small {
    color: var(--muted);
    font-size: 0.9rem;
  }
  form {
    display: flex;
    gap: 0.5rem;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 3.25rem;
    padding: 0 0.8rem;
    border-radius: 0.7rem;
    border: 1.5px solid var(--line);
    background: var(--bg);
    color: inherit;
    font: inherit;
    box-sizing: border-box;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    justify-content: center;
  }
  .done {
    margin-top: 0.25rem;
  }
</style>
