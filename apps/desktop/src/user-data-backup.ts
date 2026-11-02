/** Exclude reproducible Desktop and package files from user-data snapshots. */
import { relative, sep } from 'node:path'

const generatedProfileEntries = new Set(['node_modules', 'desktop-plugin-copies', 'desktop-runtime-state.json', 'desktop-packages-pending'])

/** Whether a path belongs to user configuration rather than installed packages. */
export function profileUserData(profile: string, path: string): boolean {
  const [entry] = relative(profile, path).split(sep)
  return entry !== 'lock' && !generatedProfileEntries.has(entry ?? '')
}

/** Keep instance data and profile configuration, excluding caches and Desktop machinery. */
export function instanceUserData(home: string, path: string): boolean {
  const [entry, profile, child] = relative(home, path).split(sep)
  if (entry === 'desktop' || entry === 'cache' || entry === 'node_modules') return false
  return entry !== 'profiles' || profile === undefined || child === undefined
    || child !== 'lock' && !generatedProfileEntries.has(child)
}
