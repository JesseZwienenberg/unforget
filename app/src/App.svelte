<script lang="ts">
  import { onMount } from 'svelte';
  import { isInstalled, registerServiceWorker, requestPersistentStorage, type ShellStatus } from './lib/pwa';

  let shell = $state<ShellStatus>('installing');
  let online = $state(navigator.onLine);
  let installed = $state(isInstalled());
  let persistent = $state<boolean | null>(null);

  const shellText: Record<ShellStatus, string> = {
    installing: 'Saving the app for offline use…',
    ready: 'Ready to open offline',
    failed: 'Offline setup failed. Reload to try again',
    unsupported: 'This browser cannot run the app offline',
  };

  onMount(() => {
    void registerServiceWorker((s) => (shell = s));
    void requestPersistentStorage().then((p) => (persistent = p));
    const mq = window.matchMedia('(display-mode: standalone)');
    const onMode = () => (installed = mq.matches);
    mq.addEventListener('change', onMode);
    return () => mq.removeEventListener('change', onMode);
  });
</script>

<svelte:window ononline={() => (online = true)} onoffline={() => (online = false)} />

<main>
  <header>
    <img src="{import.meta.env.BASE_URL}icons/icon.svg" alt="" width="56" height="56" />
    <h1>Unforget</h1>
    <p class="lede">The app is set up. Capture arrives in the next milestone.</p>
  </header>

  <ul aria-label="Status">
    <li class:ok={shell === 'ready'} class:bad={shell === 'failed' || shell === 'unsupported'}>
      <span class="dot" aria-hidden="true"></span>{shellText[shell]}
    </li>
    <li class:ok={online} class:warn={!online}>
      <span class="dot" aria-hidden="true"></span>{online ? 'Online' : 'Offline, and still working'}
    </li>
    <li class:ok={installed} class:warn={!installed}>
      <span class="dot" aria-hidden="true"></span>{installed
        ? 'Installed on this device'
        : 'Not installed yet: Chrome menu → Add to Home screen → Install'}
    </li>
    <li class:ok={persistent === true} class:warn={persistent !== true}>
      <span class="dot" aria-hidden="true"></span>{persistent === true
        ? 'Local data is protected from cleanup'
        : persistent === false
          ? 'Local data not yet protected (Chrome grants this after install)'
          : 'Checking local data protection…'}
    </li>
  </ul>

  <footer>Build {__BUILD_ID__}</footer>
</main>

<style>
  :global(:root) {
    color-scheme: light dark;
    --bg: #f7f7f4;
    --fg: #16191d;
    --muted: #5d6670;
    --line: #dedfda;
    --ok: #1a7f4b;
    --warn: #a15c00;
    --bad: #b3261e;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 17px;
    line-height: 1.45;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #111417;
      --fg: #eceef0;
      --muted: #9aa3ad;
      --line: #2a2f35;
      --ok: #5fd08f;
      --warn: #f0b354;
      --bad: #ff8a80;
    }
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    min-height: 100dvh;
  }
  main {
    max-width: 30rem;
    margin: 0 auto;
    padding: max(2.5rem, env(safe-area-inset-top)) 1.25rem 2rem;
  }
  h1 {
    font-size: 1.7rem;
    margin: 0.75rem 0 0.25rem;
    letter-spacing: -0.01em;
  }
  .lede {
    margin: 0;
    color: var(--muted);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 2rem 0;
    border-top: 1px solid var(--line);
  }
  li {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    padding: 0.85rem 0;
    border-bottom: 1px solid var(--line);
  }
  .dot {
    flex: none;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--muted);
  }
  .ok .dot {
    background: var(--ok);
  }
  .warn .dot {
    background: var(--warn);
  }
  .bad .dot {
    background: var(--bad);
  }
  footer {
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
