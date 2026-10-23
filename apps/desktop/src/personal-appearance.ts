/** Desktop validation for the personal appearance settings delivered to instance themes. */

/** Region colors follow the selected theme when their value is empty. */
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

/** Portable wallpaper, mask, and color preferences; no filesystem paths cross into instances. */
export interface PersonalAppearance {
  backgroundImage: string
  backgroundEnabled: boolean
  maskEnabled: boolean
  maskColor: string
  maskOpacity: number
  surfaceOpacity: number
  colors: PersonalColors
}

/** Default settings retain the selected base palette until the user selects a wallpaper or color. */
export const DEFAULT_PERSONAL_APPEARANCE: PersonalAppearance = {
  backgroundImage: '', backgroundEnabled: true, maskEnabled: true, maskColor: '#000000',
  maskOpacity: 35, surfaceOpacity: 80,
  colors: { canvas: '', tabs: '', sidebar: '', content: '', input: '', accent: '', text: '', muted: '' },
}

/**
 * Validate a complete personal appearance update from disk or manager IPC.
 * @param input - Untrusted settings document.
 * @returns Detached preferences accepted by the instance theme schema.
 */
export function parsePersonalAppearance(input: unknown): PersonalAppearance {
  const invalid = (): never => { throw new Error('Invalid personal appearance') }
  if (typeof input !== 'object' || !input || Array.isArray(input)) return invalid()
  const value = input as Record<string, unknown>
  const keys = Object.keys(DEFAULT_PERSONAL_APPEARANCE)
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return invalid()
  if (typeof value.backgroundImage !== 'string' || value.backgroundImage.length > 524288
    || !/^(?:data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})?$/u.test(value.backgroundImage)
    || typeof value.backgroundEnabled !== 'boolean' || typeof value.maskEnabled !== 'boolean'
    || typeof value.maskColor !== 'string' || !/^#[\da-fA-F]{6}$/u.test(value.maskColor)) return invalid()
  for (const field of ['maskOpacity', 'surfaceOpacity']) {
    const number = value[field]
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 100) return invalid()
  }
  if (typeof value.colors !== 'object' || !value.colors || Array.isArray(value.colors)) return invalid()
  const colors = value.colors as Record<string, unknown>
  const colorKeys = Object.keys(DEFAULT_PERSONAL_APPEARANCE.colors)
  if (Object.keys(colors).length !== colorKeys.length || colorKeys.some(key => typeof colors[key] !== 'string'
    || !/^(?:#[\da-fA-F]{6})?$/u.test(colors[key]))) return invalid()
  return structuredClone(input) as PersonalAppearance
}
