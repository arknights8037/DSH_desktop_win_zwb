/** Resolve the kernel's effective shortcut-open binding and translate it for Electron input. */

export type KernelPlatform = 'macos' | 'windows' | 'linux'

export interface KernelShortcutBinding {
  readonly code: string
  readonly secondCode?: string
  readonly modifiers: readonly string[]
}

const defaultOpen = { code: 'Slash', modifiers: ['primary'] } as const

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * Read the current shortcut-open binding from the kernel keybindings document.
 * Missing or malformed data falls back to the product default; an explicit null stays unbound.
 */
export function kernelOpenBinding(raw: string | null, platform: KernelPlatform): KernelShortcutBinding | null {
  if (raw === null) return { ...defaultOpen, modifiers: [...defaultOpen.modifiers] }
  let document: Record<string, unknown> | undefined
  try { document = record(JSON.parse(raw)) } catch { document = undefined }
  const profiles = record(document?.profiles)
  const desktop = record(profiles?.[`desktop:${platform}`])
  const web = record(profiles?.[`web:${platform}`])
  const override = desktop && Object.hasOwn(desktop, 'shortcuts.open') ? desktop['shortcuts.open']
    : web && Object.hasOwn(web, 'shortcuts.open') ? web['shortcuts.open'] : undefined
  if (override === null) return null
  const candidate = record(override)
  if (candidate === undefined || typeof candidate.code !== 'string'
    || !Array.isArray(candidate.modifiers)
    || !candidate.modifiers.every(value => typeof value === 'string' && ['primary', 'control', 'alt', 'shift', 'meta'].includes(value))
    || candidate.secondCode !== undefined && typeof candidate.secondCode !== 'string') {
    return { ...defaultOpen, modifiers: [...defaultOpen.modifiers] }
  }
  return {
    code: candidate.code,
    ...(candidate.secondCode === undefined ? {} : { secondCode: candidate.secondCode }),
    modifiers: [...candidate.modifiers] as string[],
  }
}

/** Convert a physical kernel code to the key label accepted by Electron input dispatch. */
export function electronShortcutKey(code: string): string | undefined {
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/u.test(code)) return code.slice(5)
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(code)) return code
  return ({
    Slash: '/', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=', Space: ' ', Enter: 'Enter', Tab: 'Tab',
    Escape: 'Escape', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  } as Record<string, string>)[code]
}

/** Convert kernel modifier names into Electron's keyboard modifier names. */
export function electronShortcutModifiers(binding: Pick<KernelShortcutBinding, 'modifiers'>, platform: KernelPlatform): string[] {
  return binding.modifiers.filter(value => value !== 'primary').concat(
    binding.modifiers.includes('primary') ? [platform === 'macos' ? 'meta' : 'control'] : [],
  )
}
