import { useState, type JSX } from 'react'

export interface ManualDraft {
  name: string
  space: string
  list: string
}

/**
 * Manual-task composer — the `3a` inset panel for adding a task not in ClickUp.
 * The 3-field variant per IMPLEMENTATION_PLAN.md Phase 3 (title + optional space +
 * optional list); the engine defaults blank space/list to "Untracked". Draft state
 * is local view state (not business logic); `onAdd` is wired to the engine in 3b.
 */
export function Composer({
  onAdd,
  onCancel
}: {
  onAdd?: (draft: ManualDraft) => void
  onCancel: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [space, setSpace] = useState('')
  const [list, setList] = useState('')

  function submit(): void {
    const trimmed = name.trim()
    if (!trimmed) return
    onAdd?.({ name: trimmed, space: space.trim(), list: list.trim() })
    setName('')
    setSpace('')
    setList('')
    onCancel()
  }

  return (
    <form
      className="inset-panel"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div className="inset-eyebrow">New untracked task</div>
      <input
        className="ci composer-name"
        aria-label="Task name"
        placeholder="What are you working on?"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="composer-fields">
        <input
          className="ci"
          aria-label="Space (optional)"
          placeholder="Space (optional)"
          value={space}
          onChange={(e) => setSpace(e.target.value)}
        />
        <input
          className="ci"
          aria-label="List (optional)"
          placeholder="List (optional)"
          value={list}
          onChange={(e) => setList(e.target.value)}
        />
      </div>
      <div className="composer-actions">
        <button type="button" className="btn-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-add">
          Add
        </button>
      </div>
    </form>
  )
}
