/** Installation stages shared by stopped-instance preparation and the shell renderer. */
export interface DesktopInstallProgress {
  readonly stage: 'checking' | 'installing' | 'copying' | 'validating' | 'backup' | 'restoring' | 'starting' | 'ready'
  readonly package?: string
  readonly completed?: number
  readonly total?: number
}

/** Reports actual stages and completed packages; omitted counts mean indeterminate progress. */
export type DesktopInstallReporter = (progress: DesktopInstallProgress) => void
