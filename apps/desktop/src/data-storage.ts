/** Restart-time relocation of Harness data with an unchanged source retained for recovery. */
import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, rename, stat, symlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Independently movable Desktop data owned by the shell. */
export type StorageCategory = 'manager' | 'instances' | 'cache' | 'plugins'
interface Location {
  version: 1
  home: string
  locations?: Partial<Record<StorageCategory, string>>
  pending?: string
  pendingCategory?: StorageCategory
}
const categories: readonly StorageCategory[] = ['manager', 'instances', 'cache', 'plugins']

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk)
  return hash.digest('hex')
}
async function canonical(path: string): Promise<string> {
  try { return await realpath(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return resolve(await canonical(parent), relative(parent, path))
  }
}

/**
 * Copy a stopped Harness home into a new directory and verify each file before use.
 * @param source - Quiescent source home; never removed or modified.
 * @param destination - New absolute directory outside the source and its ancestors.
 * @param excluded - Root entries owned by independently located categories.
 * @returns Completion after byte verification and relocation of owned package references.
 */
export async function copyDataHome(source: string, destination: string, excluded: ReadonlySet<string> = new Set()): Promise<void> {
  if (!isAbsolute(destination)) throw new Error('Data directory must be absolute')
  const from = await canonical(resolve(source))
  const to = await canonical(resolve(destination))
  if (inside(from, to) || inside(to, from)) throw new Error('Data directories must not overlap')
  await mkdir(dirname(to), { recursive: true })
  await mkdir(to, { mode: 0o700 })
  const relocate = (path: string): string => isAbsolute(path) && inside(from, path) ? join(to, relative(from, path)) : path
  const copy = async (input: string, output: string): Promise<void> => {
    for (const entry of await readdir(input, { withFileTypes: true })) {
      if (input === from && excluded.has(entry.name)) continue
      const original = join(input, entry.name)
      const target = join(output, entry.name)
      if (entry.isSymbolicLink()) {
        const link = await readlink(original)
        const resolved = resolve(dirname(original), link)
        const remapped = inside(from, resolved) ? join(to, relative(from, resolved)) : resolved
        // Junctions remain directory links; neither their contents nor external targets are traversed.
        const linkType = process.platform === 'win32' ? (await stat(original)).isDirectory() ? 'junction' : 'file' : undefined
        await symlink(isAbsolute(link) ? remapped : relative(dirname(target), remapped), target, linkType)
      } else if (entry.isDirectory()) {
        await mkdir(target, { mode: (await lstat(original)).mode })
        await copy(original, target)
      } else if (entry.isFile()) {
        await copyFile(original, target, constants.COPYFILE_EXCL)
        if (await digest(original) !== await digest(target)) throw new Error(`Data verification failed: ${original}`)
        if (entry.name === 'package.json' || entry.name === 'desktop-runtime-state.json') {
          const data = JSON.parse(await readFile(target, 'utf8')) as {
            dsh?: { profile?: { injectedPlugins?: Record<string, string> } }
            links?: Array<{ target: string }>
          }
          const injected = data.dsh?.profile?.injectedPlugins
          let changed = false
          if (injected) for (const [name, path] of Object.entries(injected)) {
            const next = relocate(path)
            if (next !== path) { injected[name] = next; changed = true }
          }
          if (entry.name === 'desktop-runtime-state.json' && Array.isArray(data.links)) for (const link of data.links) {
            const next = relocate(link.target)
            if (next !== link.target) { link.target = next; changed = true }
          }
          if (changed) await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
        }
      } else throw new Error(`Unsupported data entry: ${original}`)
    }
  }
  await copy(from, to)
}

/** Stable locator lives outside the movable data home and commits only verified destinations. */
export class DesktopDataStorage {
  private location: Location
  constructor(private readonly file: string, defaultHome: string) {
    this.location = { version: 1, home: defaultHome }
  }
  /**
   * Read category selections without starting a pending relocation.
   * @returns Completion after validating the locator; a missing locator retains defaults.
   */
  async readLocation(): Promise<void> {
    let raw: string
    try {
      const bytes = await readFile(this.file)
      raw = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null || !('version' in data) || data.version !== 1
      || !('home' in data) || typeof data.home !== 'string' || !isAbsolute(data.home)
      || 'pending' in data && (typeof data.pending !== 'string' || !isAbsolute(data.pending))) throw new Error('Invalid data location file')
    this.location = data as Location
    if (this.location.locations !== undefined && (typeof this.location.locations !== 'object' || this.location.locations === null || Array.isArray(this.location.locations)
      || Object.entries(this.location.locations).some(([key, value]) => !categories.includes(key as StorageCategory) || typeof value !== 'string' || !isAbsolute(value)))) throw new Error('Invalid category data locations')
    if (this.location.pendingCategory !== undefined && (!categories.includes(this.location.pendingCategory) || !this.location.pending)) throw new Error('Invalid pending data category')
  }
  /**
   * Finish a scheduled copy before any data owner starts.
   * @returns Active home; failures retain the original locator and clear the request.
   */
  async initialize(): Promise<string> {
    await this.readLocation()
    if (this.location.pending) {
      const target = this.location.pending
      const category = this.location.pendingCategory
      const { pending: _pending, pendingCategory: _category, ...previous } = this.location
      try {
        const source = category ? this.paths()[category] : previous.home
        await this.validateDestination(target, category)
        await mkdir(source, { recursive: true })
        await copyDataHome(source, target, category === 'manager' ? new Set(['instances', 'plugin-library']) : undefined)
        const next = category
          ? { ...previous, locations: { ...previous.locations, [category]: target } }
          : { ...previous, home: target }
        await this.commit(next)
      } catch (error) {
        await this.commit(previous)
        throw error
      }
    }
    return this.location.home
  }
  /** @returns Active category directories; child categories remain independent of manager relocation. */
  paths(): Record<StorageCategory, string> {
    const manager = join(this.location.home, 'desktop', 'agent-manager')
    return { manager, instances: join(manager, 'instances'), cache: join(this.location.home, 'desktop', 'pnpm'),
      plugins: join(manager, 'plugin-library'), ...this.location.locations }
  }
  /**
   * Schedule relocation for the next clean application launch.
   * @param destination - New absolute data directory selected by the user.
   * @param category - One independently movable category; omitted relocates the Harness home.
   * @returns Completion after saving the request outside the data home.
   */
  async schedule(destination: string, category?: StorageCategory): Promise<void> {
    if (this.location.pending) throw new Error('A data relocation is already scheduled')
    const to = await this.validateDestination(destination, category)
    try {
      await lstat(to)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.commit({ ...this.location, pending: to, ...(category ? { pendingCategory: category } : {}) })
      return
    }
    throw new Error('Choose an unoccupied data directory')
  }
  private async validateDestination(destination: string, category?: StorageCategory): Promise<string> {
    if (!isAbsolute(destination)) throw new Error('Data directory must be absolute')
    const from = await canonical(category ? this.paths()[category] : this.location.home)
    const to = await canonical(destination)
    if (inside(from, to) || inside(to, from)) throw new Error('Data directories must not overlap')
    for (const [key, path] of Object.entries(this.paths())) {
      if (!category) break
      if (key === category) continue
      const other = await canonical(path)
      if (inside(other, to) || inside(to, other)) throw new Error('Data category directories must not overlap')
    }
    return to
  }
  private async commit(value: Location): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temporary, this.file)
    this.location = value
  }
}
