/** Shell directory-menu adaptation without a patched kernel slot. */
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { installWorkspaceMenu } from '../../desktop-host/src/workspace-menu.ts'

const menuMarkup = '<div role="menu"><div role="presentation"><div><button role="menuitem"><span>icon</span><span>Rename</span></button></div><div><button role="menuitem"><span>icon</span><span>Delete</span></button></div></div></div>'
const settle = () => new Promise(resolve => setTimeout(resolve, 10))

function fixture() {
  const dom = new JSDOM('<div role="treeitem" data-row-key="workspace:known"><button id="menu">Menu</button><button id="new">New session</button></div>')
  const document = dom.window.document
  const edits: string[] = []
  const dispose = installWorkspaceMenu(document, () => 'Edit workspace', id => id === 'known', id => edits.push(id))
  const trigger = document.querySelector<HTMLButtonElement>('#menu')!
  trigger.addEventListener('click', () => {
    const menu = document.querySelector('[role="menu"]')
    if (menu) menu.remove()
    else document.body.insertAdjacentHTML('beforeend', menuMarkup)
  })
  return { dom, document, edits, dispose, trigger }
}

it('adds the editor to the directory menu and closes that menu on selection', async () => {
  const fixtureState = fixture()
  const { dom, document, edits, dispose, trigger } = fixtureState
  try {
    trigger.click()
    await settle()
    const edit = document.querySelector<HTMLButtonElement>('[data-desktop-workspace-edit]')!
    expect(edit.textContent).toBe('iconEdit workspace')
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(3)
    edit.click()
    expect(edits).toEqual(['known'])
    expect(document.querySelector('[role="menu"]')).toBeNull()
  } finally { dispose(); dom.window.close() }
})

it('does not adopt unrelated menus opened by the new-session button', async () => {
  const { dom, document, dispose } = fixture()
  try {
    const button = document.querySelector<HTMLButtonElement>('#new')!
    button.addEventListener('click', () => document.body.insertAdjacentHTML('beforeend', menuMarkup))
    button.click()
    await settle()
    expect(document.querySelector('[data-desktop-workspace-edit]')).toBeNull()
  } finally { dispose(); dom.window.close() }
})

it('withdraws pending injection on unload', async () => {
  const { dom, document, dispose, trigger } = fixture()
  try {
    trigger.click()
    dispose()
    await settle()
    expect(document.querySelector('[data-desktop-workspace-edit]')).toBeNull()
    trigger.click()
    trigger.click()
    await settle()
    expect(document.querySelector('[data-desktop-workspace-edit]')).toBeNull()
  } finally { dispose(); dom.window.close() }
})

it('removes an inserted action on unload while preserving the kernel menu', async () => {
  const { dom, document, dispose, trigger } = fixture()
  try {
    trigger.click()
    await settle()
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(3)
    dispose()
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(2)
    expect(document.querySelector('[data-desktop-workspace-edit]')).toBeNull()
  } finally { dispose(); dom.window.close() }
})

it('does not inject into a directory absent from the authoritative workspace list', async () => {
  const { dom, document, dispose, trigger } = fixture()
  try {
    trigger.parentElement!.setAttribute('data-row-key', 'workspace:unknown')
    trigger.click()
    await settle()
    expect(document.querySelector('[data-desktop-workspace-edit]')).toBeNull()
  } finally { dispose(); dom.window.close() }
})
