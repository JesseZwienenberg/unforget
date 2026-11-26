<script lang="ts">
  import { formatWhen } from '$shared/time';
  import { app } from '../lib/app.svelte';

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
