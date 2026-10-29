/** Built-in desktop appearance adapter; kernel files and profile plugins remain independent. */
import type { PersonalAppearance } from './personal-appearance.ts'

/**
 * Paint startup with the shell's saved image, single mask, palette and motion preference.
 * @param value - Validated saved personalization.
 * @param theme - Saved theme or system selection.
 * @param motionEnabled - Whether the shell permits animation.
 * @returns CSS suitable for the isolated loading document.
 */
export function loadingAppearanceCss(value: PersonalAppearance, theme: string, motionEnabled: boolean): string {
  const image = value.backgroundEnabled && value.backgroundImage
  const mask = value.maskEnabled ? `color-mix(in srgb, ${value.maskColor} ${value.maskOpacity}%, transparent)` : 'transparent'
  const colors = value.colors
  const fill = colors.content || (theme === 'dark' ? '#24262a' : theme === 'light' ? '#ffffff' : 'light-dark(#ffffff,#24262a)')
  return `:root{${image ? `--personal-content:color-mix(in srgb, ${fill} ${value.surfaceOpacity}%, transparent);` : ''}${colors.text ? `--text:${colors.text};` : ''}${theme !== 'system' ? `color-scheme:${theme};` : ''}${colors.accent ? `--brand:${colors.accent};` : ''}}
body{${colors.canvas ? `background-color:${colors.canvas};` : ''}${colors.text ? `color:${colors.text};` : ''}
${image ? `background-image:linear-gradient(${mask},${mask}),url("${image}");background-position:center;background-size:cover;background-attachment:fixed;` : ''}}
${colors.muted ? `main p{color:${colors.muted};opacity:1;}` : ''}
${!motionEnabled ? '.dsh-loader::before,.dsh-loader::after,.dsh-loader>span{animation:none!important;}' : ''}`
}

/**
 * Build an author-origin stylesheet for an instance; the manager paints the wallpaper.
 * @param value - Validated software personalization, shared by every instance.
 * @returns CSS overriding presentation only, without scripts or management capabilities.
 */
export function instanceAppearanceCss(value: PersonalAppearance): string {
  const image = value.backgroundEnabled && value.backgroundImage
  const palette = (dark: boolean): string => {
    const colors = value.colors
    const tokens: Record<string, string> = {}
    const surface = (color: string): string => image
      ? `color-mix(in srgb, ${color} ${value.surfaceOpacity}%, transparent)` : color
    if (colors.canvas) tokens['--dsw-alias-bg-base'] = colors.canvas
    for (const [key, name, fallback] of [
      ['content', 'alias-content-fill', dark ? '#151517' : '#ffffff'],
      ['sidebar', 'specific-sidebar-fill', dark ? '#212124' : '#f5f6f8'],
      ['input', 'specific-input-major', dark ? '#29292d' : '#ffffff'],
      ['tabs', 'alias-header-fill', 'transparent'],
    ] as const) {
      if (colors[key] || image) tokens[`--dsw-${name}`] = surface(colors[key] || fallback)
    }
    if (colors.content) {
      for (const level of [1, 2, 3, 4]) tokens[`--dsw-alias-bg-layer-${level}`] = colors.content
      tokens['--dsw-specific-menu'] = colors.content
      tokens['--dsw-specific-selector'] = colors.content
      tokens['--dsw-alias-interactive-bg-hover'] = `color-mix(in srgb, ${colors.text || (dark ? '#ffffff' : '#000000')} 8%, ${colors.content})`
    }
    if (colors.content || image) {
      const fill = colors.content || (dark ? '#29292d' : '#ffffff')
      const hover = `color-mix(in srgb, ${colors.text || (dark ? '#ffffff' : '#000000')} 10%, ${image ? 'transparent' : fill})`
      for (const name of ['button-elevated-fill', 'button-floating-fill']) tokens[`--dsw-alias-${name}`] = image ? 'transparent' : fill
      for (const name of ['button-floating-hover', 'button-elevated-hover', 'interactive-bg-hover']) tokens[`--dsw-alias-${name}`] = hover
      for (const name of ['tip', 'card']) tokens[`--dsw-specific-${name}`] = surface(fill)
      tokens['--dsw-alias-border-l3'] = `color-mix(in srgb, ${colors.text || (dark ? '#ffffff' : '#000000')} 18%, transparent)`
    }
    if (colors.accent) {
      for (const key of ['brand-primary', 'state-business-primary', 'link', 'button-info-fill', 'button-info-hover']) tokens[`--dsw-alias-${key}`] = colors.accent
    }
    if (colors.text) tokens['--dsw-alias-label-primary'] = colors.text
    if (colors.muted) {
      for (const key of ['secondary', 'tertiary', 'caption', 'quaternary', 'disable']) tokens[`--dsw-alias-label-${key}`] = colors.muted
    }
    if (image) {
      // Main and sidebar columns each paint once, including clients without desktop fill tokens.
      tokens['--dsw-alias-bg-base'] = 'transparent'
      tokens['--dsw-alias-app-fill'] = 'transparent'
      tokens['--dsh-personal-composer-fill'] = 'transparent'
      for (const name of ['bg-layer-1', 'bg-layer-2', 'bg-module-platform']) tokens[`--dsw-alias-${name}`] = 'transparent'
      // Floating surfaces must not inherit the transparent document canvas.
      for (const name of ['--dsw-specific-menu', '--dsw-specific-selector', '--dsw-alias-bg-layer-3']) {
        tokens[name] = colors.content || (dark ? '#29292d' : '#ffffff')
      }
      tokens['--dsh-desktop-popup-fill'] = colors.content || (dark ? '#29292d' : '#ffffff')
    }
    return Object.entries(tokens).map(([key, color]) => `${key}:${color}!important;`).join('')
  }
  // Clearing instance wallpaper prevents a second mask and a differently cropped image.
  const canvas = image ? 'html,body{background:transparent!important;}' : ''
  // Slot names survive CSS Module rebuilds and apply to panels mounted after injection.
  const regions = image ? `
[data-slot="root"] > * { background: transparent !important; }
[data-slot="root"] > * > :has(> [data-slot="main"]),
[data-rightbar-col] { background: var(--dsw-alias-content-fill) !important; }
[data-slot="root"] > * > :has(> [data-slot="sidebar"]) { background: var(--dsw-specific-sidebar-fill) !important; }
[data-slot="sidebar"] > *,
[data-slot="main.conversation"] > * { background: transparent !important; }
dialog, [role="dialog"], [role="menu"], [data-trigger-menu] {
  --dsw-alias-bg-base: var(--dsh-desktop-popup-fill) !important;
  --dsw-alias-bg-layer-1: var(--dsh-desktop-popup-fill) !important;
  --dsw-alias-bg-layer-2: var(--dsh-desktop-popup-fill) !important;
  --dsw-alias-bg-module-platform: var(--dsh-desktop-popup-fill) !important;
}` : ''
  const settingsCopy = `
[data-shortcut-modal="settings"] :is([class*="desc"], [class*="Desc"], [class*="hint"], [class*="Hint"], [class*="intro"], [class*="Intro"], [class*="subtitle"], [class*="Subtitle"], [class*="helper"], [class*="Helper"], [class*="note"], [class*="Note"], [class*="guide"], [class*="Guide"]):not([role="alert"]):not([role="status"]):not([aria-live]),
body:has([data-shortcut-modal="settings"]) > [role="dialog"] :is([class*="desc"], [class*="Desc"], [class*="hint"], [class*="Hint"], [class*="intro"], [class*="Intro"], [class*="subtitle"], [class*="Subtitle"], [class*="helper"], [class*="Helper"], [class*="note"], [class*="Note"], [class*="guide"], [class*="Guide"]):not([role="alert"]):not([role="status"]):not([aria-live]) { display: none !important; }
[data-shortcut-modal="settings"] :is(input, textarea)[placeholder]::placeholder,
body:has([data-shortcut-modal="settings"]) > [role="dialog"] :is(input, textarea)[placeholder]::placeholder { color: transparent !important; }`
  return `${canvas}body{--dsh-personal-wallpaper:none!important;${palette(false)}}body[data-ds-dark-theme]{${palette(true)}}${regions}${settingsCopy}`
}
