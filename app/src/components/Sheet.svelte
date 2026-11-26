<script lang="ts">
  import type { Snippet } from 'svelte';

  let { open, title, onclose, children }: { open: boolean; title: string; onclose: () => void; children: Snippet } = $props();
  let dialog: HTMLDialogElement;

  // A native <dialog>: the Android back gesture and Esc close it, and focus
  // returns to the capture box afterwards.
  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-label={title}
  {onclose}
  onclick={(e) => {
    if (e.target === dialog) dialog.close();
  }}
>
  <div class="sheet">
    <header>
      <h2>{title}</h2>
      <button type="button" class="close" aria-label="Close" onclick={() => dialog.close()}>✕</button>
    </header>
    {#if open}{@render children()}{/if}
  </div>
</dialog>

<style>
  dialog {
    border: 0;
    padding: 0;
    margin: auto auto 0;
    width: 100%;
    max-width: 34rem;
    max-height: 92dvh;
    background: transparent;
    color: inherit;
    overflow: visible;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  .sheet {
    background: var(--surface);
    border-radius: 1.1rem 1.1rem 0 0;
    padding: 0.5rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom));
    max-height: 92dvh;
    overflow-y: auto;
    box-shadow: 0 -8px 30px rgb(0 0 0 / 0.25);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0;
  }
  .close {
    width: 3rem;
    height: 3rem;
    margin-right: -0.8rem;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 1.1rem;
  }
  @media (min-width: 40rem) {
    dialog {
      margin: auto;
    }
    .sheet {
      border-radius: 1.1rem;
    }
  }
</style>
