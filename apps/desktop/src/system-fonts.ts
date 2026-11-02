/** Read installed font family names from the operating system. */
import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'

/** Parse the value names returned by Windows' installed-font registry. */
export function parseWindowsFontFamilies(output: string): string[] {
  const families = new Set<string>()
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^\s*(.*?)\s+REG_(?:SZ|EXPAND_SZ)\s+/u)
    if (!match?.[1]) continue
    const family = match[1].replace(/\s*\((?:TrueType|OpenType|Variable)\)\s*$/iu, '')
      .replace(/\s+(?:Regular|Bold(?:\s+Italic)?|Italic|SemiBold|SemiLight|Light|Medium|DemiBold|Book)$/iu, '').trim()
    if (family && !/^(?:font name|default)$/iu.test(family)) families.add(family)
  }
  return [...families].sort((a, b) => a.localeCompare(b))
}

/** Query system-installed fonts without exposing arbitrary commands to renderer IPC. */
export function systemFontFamilies(): string[] {
  try {
    if (platform() === 'win32') {
      const outputs = ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
        'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'].flatMap(key => {
        try { return [execFileSync('reg.exe', ['query', key], { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 })] }
        catch { return [] }
      })
      return parseWindowsFontFamilies(outputs.join('\n'))
    }
    const output = execFileSync('fc-list', [':', 'family'], { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 })
    return [...new Set(output.split(/[\r\n,]+/u).map(name => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}
