<script lang="ts">
  import { KNOWN_PRESETS, type Settings } from '$shared/settings';
  import { actionLabel, snoozeLabel } from '$shared/snooze';
  import { formatWhen } from '$shared/time';
  import { LIST_NAMES, LISTS } from '$shared/types';
  import { app } from '../lib/app.svelte';

  // A private copy to edit; nothing changes until Save.
  const s = $state<Settings>($state.snapshot(app.settings) as Settings);
  let sections = $state(app.settings.grocerySections.join('\n'));
  let problems = $state<string[]>([]);

  const DAYS = [
    { n: 1, name: 'Mon' },
    { n: 2, name: 'Tue' },
    { n: 3, name: 'Wed' },
    { n: 4, name: 'Thu' },
    { n: 5, name: 'Fri' },
    { n: 6, name: 'Sat' },
    { n: 0, name: 'Sun' },
  ];
  const presets = $derived([...new Set([...KNOWN_PRESETS, ...app.settings.snoozePresets])]);
  const actions = $derived(['done', ...presets.map((p) => `snooze:${p}`)]);
  const FADING: { key: keyof Settings['fading']; label: string; help: string }[] = [
    { key: 'personalDays', label: 'Personal, no date', help: 'days untouched' },
    { key: 'workDays', label: 'Work, no date', help: 'days untouched' },
    { key: 'overdueDays', label: 'Overdue', help: 'days after its time' },
    { key: 'groceriesDays', label: 'Groceries', help: 'days untouched' },
  ];

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function setFading(key: keyof Settings['fading'], raw: string) {
    s.fading[key] = raw.trim() === '' ? null : Number(raw);
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const draft: Settings = {
      ...($state.snapshot(s) as Settings),
      timeZone: s.timeZone.trim(),
      // Keep the snooze options in a sensible, fixed order.
      snoozePresets: presets.filter((p) => s.snoozePresets.includes(p)),
      grocerySections: sections
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
    };
    problems = await app.saveSettings(draft);
  }

  void app.loadArchived();
</script>

<form onsubmit={save}>
  <section>
    <h3>Vague times</h3>
    <p class="muted">What “morgenochtend”, “vanmiddag”, “tonight” and “dit weekend” mean.</p>
    <div class="grid">
      <label>Morning <input type="time" bind:value={s.vagueTimes.morning} required /></label>
      <label>Afternoon <input type="time" bind:value={s.vagueTimes.afternoon} required /></label>
      <label>Evening <input type="time" bind:value={s.vagueTimes.evening} required /></label>
      <label>Weekend (Saturday) <input type="time" bind:value={s.vagueTimes.weekend} required /></label>
    </div>
    <label class="wide">Time zone <input type="text" bind:value={s.timeZone} autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
  </section>

  <section>
    <h3>Morning digest</h3>
    <p class="muted">One notification with today's reminders, deadlines, overdue items and what is about to fade. Skipped on quiet days.</p>
    <label class="wide">Time <input type="time" bind:value={s.digest.time} required /></label>
    <div class="chips" role="group" aria-label="Digest days">
      {#each DAYS as day (day.n)}
        <label class:on={s.digest.days.includes(day.n)}>
          <input type="checkbox" checked={s.digest.days.includes(day.n)} onchange={() => (s.digest.days = toggle(s.digest.days, day.n))} />
          {day.name}
        </label>
      {/each}
    </div>
  </section>

  <section>
    <h3>Fading</h3>
    <p class="muted">Items nobody touches move to the archive after this many days. Leave empty for never.</p>
    <div class="grid">
      {#each FADING as f (f.key)}
        <label
          >{f.label}
          <input
            type="number"
            min="0"
            max="3650"
            step="any"
            inputmode="decimal"
            placeholder="never"
            title={f.help}
            value={s.fading[f.key] ?? ''}
            oninput={(e) => setFading(f.key, e.currentTarget.value)}
          />
        </label>
      {/each}
    </div>
  </section>

  <section>
    <h3>Notifications</h3>
    <div class="grid">
      <label
        >First button
        <select bind:value={s.notificationButtons[0]}>
          {#each actions as a (a)}<option value={a}>{actionLabel(a)}</option>{/each}
        </select>
      </label>
      <label
        >Second button
        <select bind:value={s.notificationButtons[1]}>
          {#each actions as a (a)}<option value={a}>{actionLabel(a)}</option>{/each}
        </select>
      </label>
    </div>
    <p class="muted label">Snooze options when you tap a reminder</p>
    <div class="chips" role="group" aria-label="Snooze options">
      {#each presets as p (p)}
        <label class:on={s.snoozePresets.includes(p)}>
          <input type="checkbox" checked={s.snoozePresets.includes(p)} onchange={() => (s.snoozePresets = toggle(s.snoozePresets, p))} />
          {snoozeLabel(p)}
        </label>
      {/each}
    </div>
  </section>

  <section>
    <h3>Prefixes</h3>
    <p class="muted">Start a capture with one of these and a space to pick the list yourself.</p>
    <div class="grid three">
      {#each LISTS as list (list)}
        <label>{LIST_NAMES[list]} <input type="text" bind:value={s.prefixes[list]} maxlength="12" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
      {/each}
    </div>
  </section>

  <section>
    <h3>Grocery sections</h3>
    <p class="muted">One per line, in the order you walk through the shop.</p>
    <textarea bind:value={sections} rows="8" aria-label="Grocery sections" spellcheck="false"></textarea>
  </section>

  <section>
    <h3>Smart sorting</h3>
    <label class="toggle">
      <input type="checkbox" bind:checked={s.llm.enabled} />
      <span>Sort captures automatically</span>
    </label>
    <p class="muted">
      On: captures are split, filed and timed by Claude Haiku on the server. Off: they stay as typed, under Personal unless you use a prefix.
    </p>
    <label class="wide">Most captures sorted per day <input type="number" min="0" max="5000" step="1" inputmode="numeric" bind:value={s.llm.dailyCap} /></label>
  </section>

  {#if problems.length}
    <ul class="problems" role="alert">
      {#each problems as problem (problem)}<li>{problem}</li>{/each}
    </ul>
  {/if}

  <div class="save">
    <button type="submit" class="primary">Save settings</button>
  </div>
</form>

<section>
  <h3>Archive</h3>
  <p class="muted">Faded items. Nothing is ever deleted; tap one to put it back on its list.</p>
  {#if app.archived.length}
    <ul class="archive">
      {#each app.archived as item (item.id)}
        <li>
          <button type="button" onclick={() => app.restore(item)}>
            <span>{item.title}</span>
            <small>{LIST_NAMES[item.list]} · archived {formatWhen(item.updatedAt, app.timeZone, app.now)} · Restore</small>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">The archive is empty.</p>
  {/if}
  <button type="button" onclick={() => app.cleanupNow()} disabled={app.syncState === 'unconfigured'}>Clean up now</button>
  <p class="muted note" role="status">{app.cleanupNote ?? 'Clean-up runs by itself every night at 03:00, with the saved settings.'}</p>
</section>

<section>
  <h3>Your data</h3>
  <p class="muted">Downloads every capture and item on this device, including done, archived and deleted ones.</p>
  <button type="button" onclick={() => app.exportEverything()}>Export everything (JSON)</button>
</section>

<style>
  form,
  section {
    display: flex;
    flex-direction: column;
  }
  section {
    margin-bottom: 1.4rem;
  }
  h3 {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 0.3rem;
  }
  p {
    margin: 0 0 0.6rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .label {
    margin: 0.8rem 0 0.4rem;
  }
  .note {
    margin-top: 0.6rem;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  .grid.three {
    grid-template-columns: repeat(3, 1fr);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: var(--muted);
    min-width: 0;
  }
  .wide {
    margin-top: 0.6rem;
  }
  input[type='text'],
  input[type='time'],
  input[type='number'],
  select,
  textarea {
    height: 3rem;
    padding: 0 0.7rem;
    border-radius: 0.7rem;
    border: 1.5px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 1rem;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }
  textarea {
    height: auto;
    padding: 0.6rem 0.7rem;
    line-height: 1.5;
    resize: vertical;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.6rem;
  }
  .chips label {
    flex-direction: row;
    align-items: center;
    min-height: 2.75rem;
    padding: 0 0.85rem;
    border-radius: 1.4rem;
    border: 1.5px solid var(--line);
    color: var(--fg);
    font-size: 0.92rem;
  }
  .chips label.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .chips input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .chips label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .toggle {
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
    min-height: 3rem;
    color: var(--fg);
    font-size: 1rem;
  }
  .toggle input {
    width: 1.4rem;
    height: 1.4rem;
    accent-color: var(--accent);
  }
  button {
    min-height: 3rem;
    padding: 0 1.2rem;
    border-radius: 0.7rem;
    border: 1.5px solid var(--line);
    background: none;
    color: inherit;
    font: inherit;
  }
  button:disabled {
    opacity: 0.5;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    width: 100%;
  }
  .save {
    position: sticky;
    bottom: 0;
    padding: 0.6rem 0;
    margin-bottom: 1.2rem;
    background: var(--surface);
  }
  .problems {
    margin: 0 0 0.6rem;
    padding: 0.7rem 0.9rem 0.7rem 1.9rem;
    border-radius: 0.7rem;
    border: 1.5px solid var(--bad);
    color: var(--bad);
    font-size: 0.92rem;
  }
  .archive {
    list-style: none;
    margin: 0 0 0.8rem;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .archive button {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.1rem;
    border: 0;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    padding: 0.55rem 0;
    text-align: left;
  }
  .archive span {
    overflow-wrap: anywhere;
  }
  .archive small {
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
