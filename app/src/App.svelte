<script lang="ts">
  import { LIST_NAMES } from '$shared/types';
  import CaptureBar from './components/CaptureBar.svelte';
  import EditForm from './components/EditForm.svelte';
  import ItemRow from './components/ItemRow.svelte';
  import More from './components/More.svelte';
  import SettingsForm from './components/SettingsForm.svelte';
  import Sheet from './components/Sheet.svelte';
  import SnoozeForm from './components/SnoozeForm.svelte';
  import { app, type Tab } from './lib/app.svelte';
  import { groceryLabel, groceryView, listItems, todayView } from './lib/views';

  void app.start();

  const TABS: { id: Tab; name: string }[] = [
    { id: 'today', name: 'Today' },
    { id: 'work', name: LIST_NAMES.work },
    { id: 'personal', name: LIST_NAMES.personal },
    { id: 'groceries', name: LIST_NAMES.groceries },
  ];

  // Captures still being sorted stay out of the list tabs, so nothing jumps between lists.
  // Today always shows everything: a reminder must be visible at once.
  const settled = $derived(app.sorting.size ? app.items.filter((i) => !app.sorting.has(i.id)) : app.items);
  const today = $derived(todayView(app.items, app.now, app.timeZone));
  const todayCount = $derived(today.overdue.length + today.today.length);
  const groceries = $derived(groceryView(settled, app.settings));
  const list = $derived(app.tab === 'work' || app.tab === 'personal' ? listItems(settled, app.tab) : []);

  // A tap on empty space opens the keyboard: Android will not open it by itself on a cold start.
  function focusOnEmptyTap(event: MouseEvent) {
    if (!(event.target as Element).closest('button, input, a, label')) app.focusBox();
  }

  // Short status next to the title. Says nothing when all is well.
  const status = $derived.by(() => {
    const waiting = app.waiting > 0 ? ` · ${app.waiting} waiting` : '';
    switch (app.syncState) {
      case 'unconfigured':
        return { tone: 'warn', text: 'Not connected' };
      case 'unauthorized':
        return { tone: 'bad', text: 'Reconnect needed' };
      case 'offline':
        return { tone: 'warn', text: `Offline${waiting}` };
      case 'error':
        return { tone: 'bad', text: `Sync problem${waiting}` };
      default:
        return { tone: app.updateReady ? 'warn' : 'ok', text: app.updateReady ? 'Update ready' : '' };
    }
  });
</script>

<div class="shell">
  <header>
    <h1>{TABS.find((t) => t.id === app.tab)?.name}</h1>
    <button type="button" class="status {status.tone}" class:busy={app.syncState === 'syncing'} data-sync={app.syncState} data-waiting={app.waiting} aria-label="Sync status and more" onclick={() => (app.moreOpen = true)}>
      {#if status.text}<span>{status.text}</span>{/if}
      <i aria-hidden="true"></i>
    </button>
  </header>

  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <main onclick={focusOnEmptyTap}>
    {#if app.ready && app.syncState !== 'unconfigured' && app.pushState === 'off'}
      <div class="banner">
        <span>Reminders can't reach you yet.</span>
        <button type="button" onclick={() => app.enableNotifications()} disabled={app.pushBusy}>Turn on notifications</button>
      </div>
    {/if}
    {#if !app.ready}
      <!-- local data loads in a few milliseconds; show nothing rather than flash -->
    {:else if app.tab === 'today'}
      {#if today.overdue.length}
        <h2 class="late">Overdue</h2>
        <ul>
          {#each today.overdue as item (item.id)}<ItemRow {item} showList />{/each}
        </ul>
      {/if}
      {#if today.today.length}
        {#if today.overdue.length}<h2>Today</h2>{/if}
        <ul>
          {#each today.today as item (item.id)}<ItemRow {item} showList />{/each}
        </ul>
      {/if}
      {#if !todayCount}<p class="empty">Nothing for today.</p>{/if}
    {:else if app.tab === 'groceries'}
      {#each groceries.sections as section (section.name)}
        <h2>{section.name}</h2>
        <ul>
          {#each section.items as item (item.id)}<ItemRow {item} />{/each}
        </ul>
      {/each}
      {#if !groceries.sections.length}<p class="empty">Nothing to buy. Start a line with “g ” to add something.</p>{/if}
      {#if groceries.recent.length}
        <h2>Recent</h2>
        <div class="recent">
          {#each groceries.recent as item (item.id)}
            <button type="button" onclick={() => app.readd(item.id)}><span aria-hidden="true">+</span> {groceryLabel(item)}</button>
          {/each}
        </div>
      {/if}
    {:else}
      <ul>
        {#each list as item (item.id)}<ItemRow {item} />{/each}
      </ul>
      {#if !list.length}
        <p class="empty">Nothing here. Start a line with “{app.settings.prefixes[app.tab]} ” to file it under {LIST_NAMES[app.tab]}.</p>
      {/if}
    {/if}
  </main>

  <div class="dock">
    {#if app.toast}
      {#key app.toast.key}
        <div class="toast" role="status">
          {#if app.toast.itemId}
            <button type="button" class="toast-text" onclick={() => app.toast?.itemId && app.edit(app.toast.itemId)}>
              {app.toast.text}
              {#if app.toast.warning}<strong>⚠ {app.toast.warning}</strong>{/if}
              <small>{app.toast.hint ?? 'Tap to fix'}</small>
            </button>
          {:else}
            <span class="toast-text">
              {app.toast.text}
              {#if app.toast.warning}<strong>⚠ {app.toast.warning}</strong>{/if}
            </span>
          {/if}
          {#if app.toast.undo}
            <button type="button" class="undo" onpointerdown={(e) => e.preventDefault()} onclick={() => app.toast?.undo?.()}>Undo</button>
          {/if}
        </div>
      {/key}
    {/if}

    <nav aria-label="Lists">
      {#each TABS as tab (tab.id)}
        <button type="button" aria-current={app.tab === tab.id ? 'page' : undefined} onpointerdown={(e) => e.preventDefault()} onclick={() => (app.tab = tab.id)}>
          {tab.name}{#if tab.id === 'today' && todayCount}<b>{todayCount}</b>{/if}
        </button>
      {/each}
    </nav>

    <CaptureBar />
  </div>
</div>

<Sheet open={app.editing !== null} title="Fix item" onclose={() => (app.editingId = null)}>
  {#if app.editing}
    {#key app.editing.id}<EditForm item={app.editing} />{/key}
  {/if}
</Sheet>

<Sheet open={app.snoozing !== null} title="Snooze" onclose={() => (app.snoozingId = null)}>
  {#if app.snoozing}
    {#key app.snoozing.id}<SnoozeForm item={app.snoozing} />{/key}
  {/if}
</Sheet>

<Sheet open={app.moreOpen} title="Unforget" onclose={() => (app.moreOpen = false)}>
  <More />
</Sheet>

<Sheet open={app.settingsOpen} title="Settings" onclose={() => (app.settingsOpen = false)}>
  <SettingsForm />
</Sheet>

<style>
  :global(:root) {
    color-scheme: light dark;
    --bg: #f7f7f4;
    --surface: #ffffff;
    --fg: #16191d;
    --muted: #5d6670;
    --line: #dedfda;
    --accent: #16324f;
    --on-accent: #ffffff;
    --ok: #1a7f4b;
    --warn: #a15c00;
    --bad: #b3261e;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 17px;
    line-height: 1.4;
    -webkit-text-size-adjust: 100%;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #111417;
      --surface: #1b1f24;
      --fg: #eceef0;
      --muted: #9aa3ad;
      --line: #2a2f35;
      --accent: #9cc4ee;
      --on-accent: #0c1a28;
      --ok: #5fd08f;
      --warn: #f0b354;
      --bad: #ff8a80;
    }
  }
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    overscroll-behavior: none;
  }
  :global(button) {
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  :global(button:focus-visible),
  :global(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .shell {
    height: 100dvh;
    max-width: 40rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: max(0.4rem, env(safe-area-inset-top)) 0.25rem 0 1rem;
  }
  h1 {
    font-size: 1.45rem;
    letter-spacing: -0.01em;
    margin: 0;
  }
  .status {
    height: 3rem;
    min-width: 3rem;
    padding: 0 0.85rem;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .status i {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--ok);
  }
  .status.warn i {
    background: var(--warn);
  }
  .status.bad i {
    background: var(--bad);
  }
  .status.busy i {
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  main {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 1rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  h2 {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin: 1.1rem 1rem 0.2rem;
  }
  h2.late {
    color: var(--bad);
  }
  .empty {
    color: var(--muted);
    padding: 1.5rem 1rem;
    margin: 0;
  }
  .recent {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.4rem 1rem;
  }
  .recent button {
    min-height: 2.75rem;
    padding: 0 0.9rem;
    border-radius: 1.4rem;
    border: 1.5px solid var(--line);
    background: none;
    color: var(--muted);
    font: inherit;
  }
  .dock {
    flex: none;
    border-top: 1px solid var(--line);
    background: var(--bg);
    position: relative;
  }
  nav {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
  }
  nav button {
    height: 2.9rem;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 0.92rem;
    border-top: 2.5px solid transparent;
    margin-top: -1px;
  }
  nav button[aria-current] {
    color: var(--fg);
    font-weight: 650;
    border-top-color: var(--accent);
  }
  nav b {
    margin-left: 0.35rem;
    font-size: 0.75rem;
    padding: 0.05rem 0.4rem;
    border-radius: 1rem;
    background: var(--accent);
    color: var(--on-accent);
  }
  .toast {
    position: absolute;
    left: 0.6rem;
    right: 0.6rem;
    bottom: calc(100% + 0.6rem);
    display: flex;
    align-items: stretch;
    background: var(--fg);
    color: var(--bg);
    border-radius: 0.9rem;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.25);
    overflow: hidden;
    animation: rise 0.16s ease-out;
  }
  @keyframes rise {
    from {
      transform: translateY(0.5rem);
      opacity: 0;
    }
  }
  .toast-text {
    flex: 1;
    min-width: 0;
    padding: 0.7rem 0.9rem;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .toast-text strong {
    display: block;
    font-size: 0.85rem;
  }
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin: 0.5rem 0.75rem;
    padding: 0.6rem 0.6rem 0.6rem 0.9rem;
    border-radius: 0.8rem;
    border: 1.5px solid var(--warn);
    font-size: 0.92rem;
  }
  .banner button {
    flex: none;
    min-height: 2.75rem;
    padding: 0 0.9rem;
    border-radius: 0.6rem;
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 600;
  }
  .toast-text small {
    display: block;
    opacity: 0.65;
    font-size: 0.78rem;
  }
  .undo {
    flex: none;
    min-width: 4.5rem;
    border: 0;
    border-left: 1px solid color-mix(in srgb, var(--bg) 25%, transparent);
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 650;
  }
  @media (prefers-reduced-motion: reduce) {
    .toast,
    .status.busy i {
      animation: none;
    }
  }
</style>
