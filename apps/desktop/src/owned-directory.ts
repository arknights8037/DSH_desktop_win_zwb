/** Desktop transaction cleanup that unlinks directory links without visiting their targets. */

import { lstatSync, readdirSync, rmdirSync, unlinkSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { lstat, readdir, rename, rmdir, unlink } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'

/**
 * Publish an owned directory after Windows releases transient scan and copy handles.
 * @param source - Completed, quiescent directory.
 * @param destination - Unoccupied final path on the same filesystem.
 * @returns Completion after rename; permanent failures and exhausted retries reject.
 */
export async function renameOwnedDirectory(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, destination); return }
    catch (error) {
      if (process.platform !== 'win32' || !(error instanceof Error) || !('code' in error)
        || !['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code)) || attempt === 7) throw error
      await setTimeout(25 * 2 ** attempt)
    }
  }
}

/**
 * Remove an owned directory and its contents, unlinking root and nested links.
 * Missing roots are ignored; existing roots must be directories or links.
 * @param path - Owned directory or link to remove; link targets are preserved.
 */
export function removeOwnedDirectory(path: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat === undefined) return
  if (stat.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (!stat.isDirectory()) throw new Error(`desktop project: owned directory path is not a directory: ${path}`)
  // Electron's recursive rm follows nested Windows junctions into installed resources.
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) removeOwnedDirectory(child)
    else unlinkSync(child)
  }
  rmdirSync(path)
}

/**
 * Remove a stopped kernel's files without blocking Electron or following directory links.
 * @param path - Owned directory or link; missing roots are ignored and regular-file roots reject.
 * @returns Completion after every owned entry is removed; link targets remain untouched.
 */
export async function removeOwnedDirectoryAsync(path: string): Promise<void> {
  let stat: Stats
  try { stat = await lstat(path) }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) { await unlink(path); return }
  if (!stat.isDirectory()) throw new Error(`desktop project: owned directory path is not a directory: ${path}`)
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) await removeOwnedDirectoryAsync(child)
    else await unlink(child)
  }
  await rmdir(path)
}
