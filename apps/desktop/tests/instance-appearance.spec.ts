import { expect, it } from 'vitest'
import { instanceAppearanceCss } from '../src/instance-appearance.ts'
import { DEFAULT_PERSONAL_APPEARANCE } from '../src/personal-appearance.ts'

it('keeps the wallpaper in the shell and makes instance surfaces translucent', () => {
  const value = { ...DEFAULT_PERSONAL_APPEARANCE, backgroundImage: 'data:image/png;base64,aGVsbG8=', surfaceOpacity: 25 }
  const css = instanceAppearanceCss(value)
  expect(css).toContain('html,body{background:transparent!important;}')
  expect(css).toContain('--dsw-alias-app-fill:transparent!important')
  expect(css).toContain('--dsh-personal-composer-fill:transparent!important')
  expect(css).toContain('#ffffff 25%, transparent')
  expect(css).toContain('#151517 25%, transparent')
  expect(css).not.toContain(value.backgroundImage)
})

it('keeps opaque base surfaces when a wallpaper is disabled or absent', () => {
  for (const value of [DEFAULT_PERSONAL_APPEARANCE, { ...DEFAULT_PERSONAL_APPEARANCE, backgroundImage: 'data:image/png;base64,aGVsbG8=', backgroundEnabled: false }]) {
    const css = instanceAppearanceCss(value)
    expect(css).not.toContain('html,body')
    expect(css).not.toContain('--dsw-alias-app-fill:transparent')
    expect(css).toContain('--dsh-personal-wallpaper:none!important')
  }
})

it('overrides instance palettes with independent region and foreground colors', () => {
  const css = instanceAppearanceCss({ ...DEFAULT_PERSONAL_APPEARANCE, colors: {
    canvas: '#010203', content: '#112233', tabs: '#223344', sidebar: '#334455', input: '#445566', accent: '#556677', text: '#667788', muted: '#778899',
  } })
  expect(css).toContain('--dsw-alias-bg-base:#010203!important')
  expect(css).toContain('--dsw-alias-content-fill:#112233!important')
  expect(css).toContain('--dsw-alias-header-fill:#223344!important')
  expect(css).toContain('--dsw-specific-sidebar-fill:#334455!important')
  expect(css).toContain('--dsw-specific-input-major:#445566!important')
  expect(css).toContain('--dsw-alias-brand-primary:#556677!important')
  expect(css).toContain('--dsw-alias-label-primary:#667788!important')
  expect(css).toContain('--dsw-alias-label-secondary:#778899!important')
})
