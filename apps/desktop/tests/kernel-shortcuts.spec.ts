import { expect, it } from 'vitest'
import { electronShortcutKey, electronShortcutModifiers, kernelOpenBinding } from '../src/kernel-shortcuts.ts'

it('reads a kernel shortcut override and preserves an explicit unbind', () => {
  const json = JSON.stringify({ schemaVersion: 2, profiles: { 'desktop:windows': { 'shortcuts.open': {
    code: 'KeyK', modifiers: ['primary', 'shift'],
  } } } })
  expect(kernelOpenBinding(json, 'windows')).toEqual({ code: 'KeyK', modifiers: ['primary', 'shift'] })
  expect(kernelOpenBinding(JSON.stringify({ schemaVersion: 2,
    profiles: { 'desktop:windows': { 'shortcuts.open': null } } }), 'windows')).toBeNull()
  expect(kernelOpenBinding('{', 'windows')).toEqual({ code: 'Slash', modifiers: ['primary'] })
})

it('translates physical codes and primary modifiers for Electron', () => {
  expect(electronShortcutKey('Slash')).toBe('/')
  expect(electronShortcutKey('KeyK')).toBe('K')
  expect(electronShortcutKey('ArrowDown')).toBe('Down')
  expect(electronShortcutModifiers({ modifiers: ['primary', 'shift'] }, 'windows')).toEqual(['shift', 'control'])
  expect(electronShortcutModifiers({ modifiers: ['primary'] }, 'macos')).toEqual(['meta'])
})
