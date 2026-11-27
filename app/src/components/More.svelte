<script lang="ts">
  import { formatUsd } from '$shared/cost';
  import { formatDay, formatWhen, localDate } from '$shared/time';
  import { app } from '../lib/app.svelte';

  // The sheet only exists while it is open, so this loads fresh numbers each time.
  void app.loadUsage();
  const calls = (n: number) => `${n} ${n === 1 ? 'capture' : 'captures'}`;
  const todayDate = $derived(localDate(app.now, app.timeZone));

  const status = $derived.by(() => {
    switch (app.syncState) {
      case 'unconfigured':
        return 'This device is not connected yet. Everything you capture is saved on this device only. Open your setup link on this device to connect it.';
      case 'unauthorized':
        return 'The server no longer accepts this device. Open a fresh setup link on this device.';
      case 'offline':
        return 'Offline. Everything is saved on this device and will sync when you are back online.';
      case 'error':
        return `Sync is failing: ${app.syncError ?? 'unknown error'}. Your captures are safe on this device.`;
      case 'syncing':
        return 'Syncing…';
      default:
        return 'Everything is synced.';
    }
  });
</script>

<div class="more">
  {#if app.updateReady}
    <section class="update">
      <p>A new version is ready.</p>
      <button type="button" class="primary" onclick={() => location.reload()}>Reload</button>
    </section>
  {/if}

  <section>
    <h3>Sync</h3>
    <p>{status}</p>
    <p class="muted">
      {#if app.waiting > 0}{app.waiting} {app.waiting === 1 ? 'change' : 'changes'} waiting to sync.{/if}
      {#if app.lastSyncedAt}Last synced {formatWhen(app.lastSyncedAt.toISOString(), app.timeZone, app.now)}.{/if}
      {#if app.apiHost}Server: {app.apiHost}{/if}
    </p>
    {#if app.syncState !== 'unconfigured'}
      <button type="button" onclick={() => app.requestSync()} disabled={app.syncState === 'syncing'}>Sync now</button>
    {/if}
  </section>

  <section>
    <h3>Reminders</h3>
    {#if app.pushState === 'on'}
      <p>Notifications are on for this device.</p>
      <button type="button" onclick={() => app.testNotification()} disabled={app.pushBusy}>Send a test notification</button>
    {:else if app.pushState === 'off'}
      <p>Reminders arrive as notifications. Turn them on for this device.</p>
      <button type="button" class="primary" onclick={() => app.enableNotifications()} disabled={app.pushBusy}>Turn on notifications</button>
    {:else if app.pushState === 'blocked'}
      <p>
        Notifications are blocked for this app. On Android: long-press the Unforget icon → App info (ⓘ) → Notifications → allow. Then reopen the app.
      </p>
    {:else}
      <p class="muted">This browser cannot show notifications for this app.</p>
    {/if}
    {#if app.pushNote}<p class="muted note" role="status">{app.pushNote}</p>{/if}
  </section>

  <section>
    <h3>Smart sorting</h3>
    <label class="toggle">
      <input
        type="checkbox"
        checked={app.settings.llm.enabled}
        onchange={(e) => app.updateSettings((s) => ({ ...s, llm: { ...s.llm, enabled: e.currentTarget.checked } }))}
      />
      <span>Sort captures automatically</span>
    </label>
    <p class="muted">
      {app.settings.llm.enabled
        ? 'Captures are split, filed and timed by Claude Haiku on the server. Prefixes (w, p, g) always win.'
        : 'Off: captures stay as typed, under Personal unless you use a prefix (w, p, g).'}
    </p>
  </section>

  <section>
    <h3>Spending</h3>
    {#if app.usage}
      <table>
        <tbody>
          <tr><th scope="row">Today</th><td>{formatUsd(app.usage.today.costUsd)}</td><td>{calls(app.usage.today.calls)} of {app.usage.dailyCap} allowed</td></tr>
          <tr><th scope="row">This month</th><td>{formatUsd(app.usage.month.costUsd)}</td><td>{calls(app.usage.month.calls)}</td></tr>
          <tr><th scope="row">All time</th><td>{formatUsd(app.usage.allTime.costUsd)}</td><td>{calls(app.usage.allTime.calls)}</td></tr>
        </tbody>
      </table>
      {#if app.usage.days.length > 1}
        <details>
          <summary>Per day</summary>
          <table>
            <tbody>
              {#each app.usage.days as day (day.day)}
                <tr><th scope="row">{formatDay(day.day, todayDate)}</th><td>{formatUsd(day.costUsd)}</td><td>{calls(day.calls)}</td></tr>
              {/each}
            </tbody>
          </table>
        </details>
      {/if}
      <p class="muted">
        Sorting by Claude Haiku is the only thing that costs money; hosting is free. Amounts are in US dollars, worked out from the tokens each
        capture used. Your Anthropic Console shows the actual bill and remaining credit.
      </p>
    {:else if app.usageNote}
      <p class="muted">{app.usageNote}</p>
    {:else if app.syncState === 'unconfigured'}
      <p class="muted">Shown once this device is connected.</p>
    {:else}
      <p class="muted">Loading…</p>
    {/if}
  </section>

  <section>
    <h3>Your data</h3>
    <p class="muted">Downloads every capture and item on this device, including done and deleted ones.</p>
    <button type="button" onclick={() => app.exportEverything()}>Export everything (JSON)</button>
  </section>

  <p class="muted small">
    Build {__BUILD_ID__} ·
    {app.shell === 'ready' ? 'opens offline' : app.shell === 'installing' ? 'preparing offline use…' : 'offline use unavailable'}
  </p>
</div>

<style>
  .more {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
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
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0.6rem;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: left;
    font-weight: 400;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--line);
  }
  td:nth-child(2) {
    font-weight: 600;
    padding: 0.3rem 0.75rem;
    white-space: nowrap;
  }
  td:last-child {
    color: var(--muted);
    font-size: 0.9rem;
  }
  details {
    margin-bottom: 0.6rem;
  }
  summary {
    padding: 0.7rem 0;
    color: var(--muted);
    cursor: pointer;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 3rem;
  }
  .toggle input {
    width: 1.4rem;
    height: 1.4rem;
    accent-color: var(--accent);
  }
  .note {
    margin-top: 0.6rem;
  }
  .small {
    font-size: 0.8rem;
    margin: 0;
  }
  button {
    height: 3rem;
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
  }
  .update {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.8rem;
    border: 1.5px solid var(--accent);
  }
  .update p {
    margin: 0;
  }
</style>
