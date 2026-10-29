/** Workspace extensions owned by the Desktop registry provider. */
import type { Workspace as KernelWorkspace } from '@deepseek-ai/dsh-workspace'
export type { WorkspaceId, SessionActivity } from '@deepseek-ai/dsh-workspace'

/** Desktop Workspace with primary-first source directories. */
export interface Workspace extends KernelWorkspace {
  readonly folders: readonly string[]
  /**
   * Persist the display title and validated canonical directories.
   * @param title - Validated display title.
   * @param folders - Nonempty canonical directory list, primary first.
   * @returns Completion after durable storage.
   */
  edit(title: string, folders: readonly string[]): Promise<void>
}
