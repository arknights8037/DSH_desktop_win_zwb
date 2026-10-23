/** Window-scoped desktop shortcuts; shell preferences never enter instance configuration. */
export const DEFAULT_SHORTCUTS = {
  settings: 'Ctrl+,', instances: 'Ctrl+Shift+M', add: 'Ctrl+T', close: 'Ctrl+W',
  next: 'Ctrl+Tab', previous: 'Ctrl+Shift+Tab',
} as const
/** Manager actions that can be rebound or disabled with an empty binding. */
export type ManagerShortcut = keyof typeof DEFAULT_SHORTCUTS
/** Validated, complete shortcut preferences. */
export type ManagerShortcuts = Record<ManagerShortcut, string>

/**
 * Validate persisted or IPC bindings and reject ambiguous assignments.
 * @param value - untrusted shortcut mapping.
 * @returns complete bindings for supported actions.
 */
export function parseShortcuts(value: unknown): ManagerShortcuts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid shortcuts')
  const input = value as Record<string, unknown>
  const result = { ...DEFAULT_SHORTCUTS } as ManagerShortcuts
  const used = new Set<string>()
  for (const action of Object.keys(result) as ManagerShortcut[]) {
    const binding = input[action]
    if (typeof binding !== 'string' || (binding !== '' && !/^(?=.*(?:Ctrl|Alt|Meta)\+)(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Meta\+)?(?:[A-Z0-9,]|Tab|F(?:[1-9]|1[0-9]|2[0-4]))$/u.test(binding))) throw new Error('Invalid shortcut binding')
    if (binding && used.has(binding)) throw new Error('Shortcut is already assigned')
    if (binding) used.add(binding)
    result[action] = binding
  }
  return result
}

/**
 * Normalize a keyboard event from a focused Electron window.
 * @param input - Electron keyboard input.
 * @returns the normalized accelerator, or an empty string during composition.
 */
export function shortcutBinding(input: Pick<Electron.Input, 'key' | 'control' | 'alt' | 'shift' | 'meta' | 'isComposing'>): string {
  if (input.isComposing) return ''
  const key = input.key.length === 1 ? input.key.toUpperCase() : input.key
  return [input.control ? 'Ctrl' : '', input.alt ? 'Alt' : '', input.shift ? 'Shift' : '', input.meta ? 'Meta' : '', key].filter(Boolean).join('+')
}
