import { expect, it } from 'vitest'
import { parseWindowsFontFamilies } from '../src/system-fonts.ts'

it('extracts and sorts installed Windows font family names', () => {
  expect(parseWindowsFontFamilies([
    'HKEY_LOCAL_MACHINE\\Fonts',
    '    Segoe UI (TrueType)    REG_SZ    segoeui.ttf',
    '    Cascadia Code Regular (OpenType)    REG_SZ    CascadiaCode.ttf',
    '    Segoe UI Bold (TrueType)    REG_EXPAND_SZ    segoeuib.ttf',
    '    Default    REG_SZ    ignored',
  ].join('\r\n'))).toEqual(['Cascadia Code', 'Segoe UI'])
})
