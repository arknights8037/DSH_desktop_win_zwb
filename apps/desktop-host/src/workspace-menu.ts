/** Desktop adapter for the kernel's directory-row menu DOM. */

/**
 * Add an editor action only to a newly opened real workspace menu.
 * @param document - Instance document owned by this plugin lifetime.
 * @param label - Current localized editor label.
 * @param hasWorkspace - Validate the row identity against the live workspace list.
 * @param edit - Open the shell editor for a validated workspace identity.
 * @returns Removes listeners, pending work, and inserted menu actions.
 */
export function installWorkspaceMenu(
  document: Document,
  label: () => string,
  hasWorkspace: (id: string) => boolean,
  edit: (id: string) => void,
): () => void {
  const view = document.defaultView
  if (!view) throw new Error('Desktop workspace menu requires a window')
  let pending: ReturnType<typeof setTimeout> | undefined
  let inserted: HTMLButtonElement | undefined
  const onClick = (event: MouseEvent): void => {
    if (!(event.target instanceof view.Element)) return
    const trigger = event.target.closest('button')
    const row = trigger?.closest('[role="treeitem"][data-row-key]')
    const key = row?.getAttribute('data-row-key')
    if (!trigger || !row || !key?.startsWith('workspace:')) return
    // The directory's first button opens its menu; the second starts a session.
    if (row.querySelector('button') !== trigger) return
    const id = key.slice('workspace:'.length)
    if (!hasWorkspace(id)) return
    if (pending !== undefined) clearTimeout(pending)
    const existing = new Set(document.querySelectorAll('[role="menu"]'))
    pending = setTimeout(() => {
      pending = undefined
      if (!trigger.isConnected || !hasWorkspace(id)) return
      const opened = [...document.querySelectorAll('[role="menu"]')].filter(menu => !existing.has(menu))
      if (opened.length !== 1) return
      const menu = opened[0]!
      const items = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
      // Supported kernel layout: Rename and Delete in separate viewport rows.
      if (items.length !== 2 || items.some(item => item.closest('[role="menu"]') !== menu)) return
      const first = items[0]!
      const viewport = first.parentElement?.parentElement
      if (!viewport || viewport.getAttribute('role') !== 'presentation'
        || items[1]!.parentElement?.parentElement !== viewport
        || first.children.length !== 2 || first.lastElementChild?.tagName !== 'SPAN') return
      inserted?.remove()
      // cloneNode copies the kernel's icon and CSS classes, never React handlers.
      const button = first.cloneNode(true) as HTMLButtonElement
      button.removeAttribute('id')
      button.removeAttribute('aria-keyshortcuts')
      button.lastElementChild!.textContent = label()
      button.setAttribute('data-desktop-workspace-edit', id)
      button.addEventListener('click', click => {
        click.preventDefault()
        click.stopPropagation()
        if (!hasWorkspace(id) || !trigger.isConnected) return
        trigger.click()
        edit(id)
      })
      viewport.insertBefore(button, viewport.firstChild)
      inserted = button
    }, 0)
  }
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('click', onClick, true)
    if (pending !== undefined) clearTimeout(pending)
    inserted?.remove()
  }
}
