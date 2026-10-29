/** Bounded desktop diagnostics available before data storage and kernel initialization. */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { redactDiagnostic } from './instance-service.ts'

function errorDetails(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return String(error)
  if (depth >= 4) return error.message
  return [error.stack ?? error.message,
    ...(error.cause === undefined ? [] : [`Caused by: ${errorDetails(error.cause, depth + 1)}`]),
    ...(error instanceof AggregateError ? error.errors.map((cause: unknown) => errorDetails(cause, depth + 1)) : []),
  ].join('\n')
}

/**
 * Retain installation stages and redacted errors without logging request bodies or credentials.
 * @param path - Stable log outside the movable Harness home and application installation.
 */
export class DesktopDiagnostics {
  private writable = false
  constructor(readonly path: string) {}

  /** @returns Whether the most recent write reached the log; failures also reach stderr. */
  available(): boolean { return this.writable }

  /**
   * Record an operation stage or version identity.
   * @param operation - Shell-owned operation name.
   * @param detail - Stage metadata without user configuration or command output.
   */
  info(operation: string, detail: unknown): void { this.write(operation, JSON.stringify(detail)) }

  /**
   * Record a failure with its stack and nested causes.
   * @param operation - Affected operation, excluding request payloads.
   * @param error - Failure whose cause chain remains available for diagnosis.
   */
  error(operation: string, error: unknown): void { this.write(operation, errorDetails(error)) }

  private write(operation: string, detail: string): void {
    const safe = redactDiagnostic(detail)
      .replace(/\b(?:Bearer|Basic)\s+[^\s"',;]+/giu, 'Bearer [redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]+/gu, '[redacted]')
      .replace(/((?:api[_-]?key|password|passphrase|token)["']?\s*[=:]\s*["']?)[^"'\s,;\\]+/giu, '$1[redacted]')
    const line = `${new Date().toISOString()} ${operation}\n${safe}\n`
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
      if (existsSync(this.path) && statSync(this.path).size >= 4 * 1024 * 1024) {
        rmSync(`${this.path}.previous`, { force: true })
        renameSync(this.path, `${this.path}.previous`)
      }
      appendFileSync(this.path, line, { mode: 0o600 })
      this.writable = true
    } catch (error) {
      this.writable = false
      process.stderr.write(`Desktop log unavailable: ${String(error)}\n${line}`)
    }
  }
}
