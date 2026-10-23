/** Validated personal colors and raster wallpaper delivered through user settings. */
import z from '@deepseek-ai/schemastery'

/** Region backgrounds and the shared foreground colors; empty values follow the base theme. */
export interface PersonalColors {
  canvas: string
  tabs: string
  sidebar: string
  content: string
  input: string
  accent: string
  text: string
  muted: string
}

/** Desktop-authored appearance shared with the instance's theme presenter. */
export interface ThemeCustomization {
  backgroundImage: string
  backgroundEnabled: boolean
  maskEnabled: boolean
  maskColor: string
  maskOpacity: number
  surfaceOpacity: number
  colors: PersonalColors
}

const color = () => z.string().pattern(/^(?:#[\da-fA-F]{6})?$/u).required()
const percent = () => z.number().step(1).min(0).max(100).required()

/** Wire schema allows embedded raster images only; no external or local-file URLs. */
export const ThemeCustomizationSchema: z<ThemeCustomization> = z.object({
  backgroundImage: z.string().pattern(/^(?:data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})?$/u).max(524288).required(),
  backgroundEnabled: z.boolean().required(),
  maskEnabled: z.boolean().required(),
  maskColor: z.string().pattern(/^#[\da-fA-F]{6}$/u).required(),
  maskOpacity: percent(),
  surfaceOpacity: percent(),
  colors: z.object({ canvas: color(), tabs: color(), sidebar: color(), content: color(), input: color(),
    accent: color(), text: color(), muted: color() }).required(),
})

/**
 * Resolve personal colors into semantic tokens over the selected base palette.
 * @param custom - Validated settings; absence retains the base palette.
 * @param dark - Whether the resolved base palette is dark.
 * @returns Token overrides, including a fixed wallpaper with an optional color mask.
 */
export function customizationTokens(custom: ThemeCustomization | undefined, dark: boolean): Record<string, string> {
  if (!custom) return {}
  const tokens: Record<string, string> = {}
  const colors = custom.colors
  const image = custom.backgroundEnabled && custom.backgroundImage
  const surface = (value: string): string => image
    ? `color-mix(in srgb, ${value} ${custom.surfaceOpacity}%, transparent)` : value
  if (colors.canvas) {
    tokens['--dsh-personal-canvas'] = colors.canvas
    tokens['--dsw-alias-bg-base'] = colors.canvas
  }
  if (colors.content || image) tokens['--dsw-alias-content-fill'] = surface(colors.content || (dark ? '#151517' : '#ffffff'))
  if (colors.sidebar || image) tokens['--dsw-specific-sidebar-fill'] = surface(colors.sidebar || (dark ? '#212124' : '#f5f6f8'))
  if (colors.input || image) tokens['--dsw-specific-input-major'] = surface(colors.input || (dark ? '#29292d' : '#ffffff'))
  if (colors.tabs) tokens['--dsw-alias-header-fill'] = surface(colors.tabs)
  if (colors.content) {
    for (const level of [1, 2, 3, 4]) tokens[`--dsw-alias-bg-layer-${level}`] = colors.content
    tokens['--dsw-specific-menu'] = colors.content
    tokens['--dsw-specific-selector'] = colors.content
    tokens['--dsw-alias-interactive-bg-hover'] = `color-mix(in srgb, ${colors.text || (dark ? '#ffffff' : '#000000')} 8%, ${colors.content})`
  }
  if (colors.accent) {
    for (const name of ['brand-primary', 'state-business-primary', 'link', 'button-info-fill', 'button-info-hover']) tokens[`--dsw-alias-${name}`] = colors.accent
  }
  if (colors.text) tokens['--dsw-alias-label-primary'] = colors.text
  if (colors.muted) {
    for (const name of ['secondary', 'tertiary', 'caption', 'quaternary', 'disable']) tokens[`--dsw-alias-label-${name}`] = colors.muted
  }
  if (image) {
    const mask = custom.maskEnabled ? `color-mix(in srgb, ${custom.maskColor} ${custom.maskOpacity}%, transparent)` : 'transparent'
    tokens['--dsh-personal-wallpaper'] = `linear-gradient(${mask}, ${mask}), url("${image}")`
    tokens['--dsw-alias-app-fill'] = 'transparent'
  }
  return tokens
}
