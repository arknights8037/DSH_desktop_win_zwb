/** Shell-owned presentation of backend documents through DSH semantic color tokens. */
import type { PersonalAppearance } from './personal-appearance.ts'

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
    if (colors.accent) {
      for (const key of ['brand-primary', 'state-business-primary', 'link', 'button-info-fill', 'button-info-hover']) tokens[`--dsw-alias-${key}`] = colors.accent
    }
    if (colors.text) tokens['--dsw-alias-label-primary'] = colors.text
    if (colors.muted) {
      for (const key of ['secondary', 'tertiary', 'caption', 'quaternary', 'disable']) tokens[`--dsw-alias-label-${key}`] = colors.muted
    }
    if (image) {
      tokens['--dsw-alias-app-fill'] = 'transparent'
      tokens['--dsh-personal-composer-fill'] = 'transparent'
    }
    return Object.entries(tokens).map(([key, color]) => `${key}:${color}!important;`).join('')
  }
  // Clearing instance wallpaper prevents a second mask and a differently cropped image.
  const canvas = image ? 'html,body{background:transparent!important;}' : ''
  return `${canvas}body{--dsh-personal-wallpaper:none!important;${palette(false)}}body[data-ds-dark-theme]{${palette(true)}}`
}
