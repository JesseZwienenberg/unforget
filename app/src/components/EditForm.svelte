<script lang="ts">
  import { dueDate, fromInputValue, toInputValue } from '$shared/time';
  import { LIST_NAMES, LISTS, type Item, type ListId } from '$shared/types';
  import { app } from '../lib/app.svelte';

  let { item }: { item: Item } = $props();

  // svelte-ignore state_referenced_locally
  let title = $state(item.title);
  // svelte-ignore state_referenced_locally
  let list = $state<ListId>(item.list);
  // svelte-ignore state_referenced_locally
  let remind = $state(item.remindAt ? toInputValue(item.remindAt, app.timeZone) : '');
  // svelte-ignore state_referenced_locally
  let due = $state(item.dueAt ? dueDate(item.dueAt, app.timeZone) : '');
  // svelte-ignore state_referenced_locally
  const original = { remind, due };

  function save(event: SubmitEvent) {
    event.preventDefault();
    void app.saveEdit(item.id, {
      title: title.trim() || item.title,
      list,
      // Untouched fields keep their exact stored value.
      remindAt: remind === original.remind ? item.remindAt : remind ? fromInputValue(remind, app.timeZone) : null,
      dueAt: due === original.due ? item.dueAt : due || null,
    });
  }
</script>

<form onsubmit={save}>
  <label class="field">
    <span>Title</span>
    <input type="text" bind:value={title} autocomplete="off" enterkeyhint="done" />
  </label>

  <fieldset>
    <legend>List</legend>
    <div class="lists">
      {#each LISTS as id (id)}
        <label class:on={list === id}>
          <input type="radio" name="list" value={id} bind:group={list} />
          {LIST_NAMES[id]}
        </label>
      {/each}
    </div>
  </fieldset>

  <div class="field">
    <label for="edit-remind">Remind me at</label>
    <div class="with-clear">
      <input id="edit-remind" type="datetime-local" bind:value={remind} />
      {#if remind}<button type="button" class="clear" onclick={() => (remind = '')}>Clear</button>{/if}
    </div>
  </div>

  <div class="field">
    <label for="edit-due">Deadline</label>
    <div class="with-clear">
      <input id="edit-due" type="date" bind:value={due} />
      {#if due}<button type="button" class="clear" onclick={() => (due = '')}>Clear</button>{/if}
    </div>
  </div>

  <div class="actions">
    <button type="button" class="danger" onclick={() => app.remove(item.id)}>Delete</button>
    <button type="submit" class="primary">Save</button>
  </div>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding-top: 0.25rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .field > span,
  .field > label,
  legend {
    font-size: 0.82rem;
    color: var(--muted);
    padding: 0;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  input[type='text'],
  input[type='datetime-local'],
  input[type='date'] {
    height: 3rem;
    padding: 0 0.8rem;
    border-radius: 0.7rem;
    border: 1.5px solid var(--line);
    background: var(--bg);
    color: inherit;
    font: inherit;
    min-width: 0;
    box-sizing: border-box;
  }
  .with-clear {
    display: flex;
    gap: 0.5rem;
  }
  .with-clear input {
    flex: 1;
  }
  .lists {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin-top: 0.3rem;
  }
  .lists label {
    height: 3rem;
    display: grid;
    place-items: center;
    border-radius: 0.7rem;
    border: 1.5px solid var(--line);
  }
  .lists label.on {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .lists input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .lists label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: 0.25rem;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    min-width: 8rem;
  }
  .danger {
    color: var(--bad);
  }
</style>
