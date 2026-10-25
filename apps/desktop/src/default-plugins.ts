/** Reviewed product defaults for the independently updated DSH kernel. */
import type { LibraryPlugin } from './plugin-library.ts'

/** Exact versions keep new-instance initialization reproducible across registry changes. */
export const DESKTOP_DEFAULT_PLUGINS: readonly LibraryPlugin[] = [
  { name: 'dsh-at-file', version: '0.6.3' },
  { name: 'dsh-context', version: '0.75.1' },
  { name: 'dsh-cost-meter', version: '1.9.39' },
]
