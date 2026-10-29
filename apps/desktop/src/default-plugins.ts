/** Reviewed product defaults for the independently updated DSH kernel. */
import type { LibraryPlugin } from './plugin-library.ts'

/** Exact versions keep new-instance initialization reproducible across registry changes. */
export const DESKTOP_DEFAULT_PLUGINS: readonly LibraryPlugin[] = [
  { name: 'dsh-context', version: '0.77.0' },
  { name: 'dsh-cost-meter', version: '1.9.41' },
]
