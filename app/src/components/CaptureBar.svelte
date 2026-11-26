<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/app.svelte';

  let text = $state('');
  let input: HTMLInputElement;

  // Land in the box. Android decides whether the keyboard opens without a tap.
  onMount(() => input.focus());

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const value = text;
    if (!value.trim()) return;
    text = '';
    input.focus();
    void app.capture(value, 'typed');
  }
</script>

<form onsubmit={submit}>
  <!-- svelte-ignore a11y_autofocus -->
  <input
    bind:this={input}
    bind:value={text}
    type="text"
    autofocus
    enterkeyhint="send"
    autocomplete="off"
    autocapitalize="sentences"
    placeholder="Type anything, press enter"
    aria-label="Capture"
  />
  <!-- pointerdown is cancelled so tapping the button never closes the keyboard -->
  <button type="submit" aria-label="Save" disabled={!text.trim()} onpointerdown={(e) => e.preventDefault()}>
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 19V6m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>
</form>

<style>
  form {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem calc(0.6rem + env(safe-area-inset-bottom));
  }
  input {
    flex: 1;
    min-width: 0;
    height: 3rem;
    padding: 0 1.1rem;
    border-radius: 1.5rem;
    border: 1.5px solid var(--line);
    background: var(--surface);
    color: inherit;
    font: inherit;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  input::placeholder {
    color: var(--muted);
  }
  button {
    flex: none;
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
    display: grid;
    place-items: center;
  }
  button:disabled {
    opacity: 0.35;
  }
</style>
