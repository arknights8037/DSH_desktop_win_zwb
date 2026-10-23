import { expect, it } from 'vitest'
import { ThemeSettingsSchema } from '../src/theme-settings.ts'
import { customizationTokens, type ThemeCustomization } from '../src/customization.ts'

const customization: ThemeCustomization = {
  backgroundImage: 'data:image/webp;base64,UklGRg==', backgroundEnabled: true,
  maskEnabled: true, maskColor: '#102030', maskOpacity: 35, surfaceOpacity: 75,
  colors: { canvas: '#182030', tabs: '#203040', sidebar: '#304050', content: '#405060', input: '#506070',
    accent: '#708090', text: '#ffffff', muted: '#aabbcc' },
}
const parse = (value: unknown) => (ThemeSettingsSchema as unknown as (value: unknown) => unknown)(value)

it('loads old theme settings and validates portable appearance at the settings boundary', () => {
  expect(parse({})).toEqual({ preference: 'system', fontSize: 14 })
  expect(parse({ customization })).toMatchObject({ customization })
  for (const value of [
    { ...customization, backgroundImage: 'file:///private/photo.png' },
    { ...customization, backgroundImage: 'https://example.com/photo.png' },
    { ...customization, backgroundImage: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { ...customization, backgroundImage: `data:image/png;base64,${'A'.repeat(524288)}` },
    { ...customization, maskOpacity: -1 }, { ...customization, surfaceOpacity: 101 },
    { ...customization, maskOpacity: 1.5 }, { ...customization, backgroundEnabled: 'yes' },
    { ...customization, colors: { ...customization.colors, text: 'url(https://example.com)' } },
  ]) expect(() => parse({ customization: value })).toThrow()
})

it('supports masks, unmasked images, independent region colors and text, and returns to theme defaults', () => {
  const tokens = customizationTokens(customization, true)
  expect(tokens['--dsh-personal-wallpaper']).toContain('color-mix(in srgb, #102030 35%, transparent)')
  expect(tokens['--dsw-alias-content-fill']).toBe('color-mix(in srgb, #405060 75%, transparent)')
  expect(tokens['--dsw-specific-sidebar-fill']).toContain('#304050')
  expect(tokens['--dsw-specific-input-major']).toContain('#506070')
  expect(tokens['--dsw-alias-label-primary']).toBe('#ffffff')
  expect(tokens['--dsw-alias-label-secondary']).toBe('#aabbcc')
  expect(tokens['--dsw-alias-link']).toBe('#708090')
  expect(customizationTokens({ ...customization, maskEnabled: false }, false)['--dsh-personal-wallpaper']).toContain('linear-gradient(transparent, transparent)')
  const disabled = customizationTokens({ ...customization, backgroundEnabled: false }, true)
  expect(disabled['--dsh-personal-wallpaper']).toBeUndefined()
  expect(disabled['--dsw-alias-content-fill']).toBe('#405060')
  const defaults = { ...customization, backgroundImage: '', colors: { canvas: '', tabs: '', sidebar: '', content: '', input: '', accent: '', text: '', muted: '' } }
  expect(customizationTokens(defaults, false)).toEqual({})
  expect(customizationTokens(undefined, false)).toEqual({})
})
