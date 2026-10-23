/** Desktop-owned DSH preferences and their allowlisted instance fields. */

/** Non-secret preferences delivered to every managed DSH instance. */
export interface DshSettings {
  transcriptView: 'normal' | 'compact'
  modeSelectionEnabled: boolean
  defaultPreset: string
  deepseekProtocol: 'messages' | 'chat-completions'
  deepseekBaseURL: string
  deepseekKeyRef: string
  deepseekMaxTokens: number
  reasoningEffort: 'off' | 'low' | 'high' | 'max'
}

/** Initial software choices match the shipped DSH web composition. */
export const DEFAULT_DSH_SETTINGS: Readonly<DshSettings> = {
  transcriptView: 'compact', modeSelectionEnabled: true, defaultPreset: 'standard',
  deepseekProtocol: 'messages', deepseekBaseURL: 'https://api.deepseek.com/anthropic',
  deepseekKeyRef: 'DEEPSEEK_API_KEY', deepseekMaxTokens: 256_000, reasoningEffort: 'high',
}

/**
 * Validate a complete non-secret settings document from IPC or disk.
 * @param input - untrusted persisted or renderer preferences.
 * @returns a detached document containing only supported preferences.
 */
export function parseDshSettings(input: unknown): DshSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid DSH settings')
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => !Object.hasOwn(DEFAULT_DSH_SETTINGS, key))
    || !['normal', 'compact'].includes(String(value.transcriptView)) || typeof value.transcriptView !== 'string'
    || typeof value.modeSelectionEnabled !== 'boolean'
    || typeof value.defaultPreset !== 'string' || !value.defaultPreset.trim() || value.defaultPreset.length > 256
    || typeof value.deepseekProtocol !== 'string' || !['messages', 'chat-completions'].includes(value.deepseekProtocol)
    || typeof value.deepseekBaseURL !== 'string' || value.deepseekBaseURL.length > 4096
    || typeof value.deepseekKeyRef !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value.deepseekKeyRef)
    || value.deepseekKeyRef.length > 256 || typeof value.deepseekMaxTokens !== 'number'
    || !Number.isSafeInteger(value.deepseekMaxTokens) || value.deepseekMaxTokens < 1
    || typeof value.reasoningEffort !== 'string' || !['off', 'low', 'high', 'max'].includes(value.reasoningEffort)) {
    throw new Error('Invalid DSH settings')
  }
  const url = new URL(value.deepseekBaseURL)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('DSH model URL must be HTTP(S) without credentials, query, or fragment')
  }
  return { transcriptView: value.transcriptView as DshSettings['transcriptView'], modeSelectionEnabled: value.modeSelectionEnabled,
    defaultPreset: value.defaultPreset.trim(), deepseekProtocol: value.deepseekProtocol as DshSettings['deepseekProtocol'],
    deepseekBaseURL: value.deepseekBaseURL, deepseekKeyRef: value.deepseekKeyRef, deepseekMaxTokens: value.deepseekMaxTokens,
    reasoningEffort: value.reasoningEffort as DshSettings['reasoningEffort'] }
}

/**
 * Project software choices into DSH namespaces without replacing unrelated instance fields.
 * @param settings - validated desktop preferences.
 * @returns namespace edits, applied atomically within each namespace.
 */
export function dshSettingsEdits(settings: DshSettings): Array<[string, Record<string, unknown>]> {
  return [
    ['ui-chat', { transcriptView: settings.transcriptView }],
    ['agent-presets', { default: settings.defaultPreset, modeSelectionEnabled: settings.modeSelectionEnabled }],
    ['llm-deepseek', { protocol: settings.deepseekProtocol, baseURL: settings.deepseekBaseURL,
      apiKeyEnv: settings.deepseekKeyRef, maxTokens: settings.deepseekMaxTokens, reasoningEffort: settings.reasoningEffort }],
  ]
}
