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
  reasoningEffort: string
  defaultProvider: string
  defaultModel: string
}

/** Initial software choices match the shipped DSH web composition. */
export const DEFAULT_DSH_SETTINGS: Readonly<DshSettings> = {
  transcriptView: 'compact', modeSelectionEnabled: true, defaultPreset: 'standard',
  deepseekProtocol: 'messages', deepseekBaseURL: 'https://api.deepseek.com/anthropic',
  deepseekKeyRef: 'DEEPSEEK_API_KEY', deepseekMaxTokens: 256_000, reasoningEffort: 'high',
  defaultProvider: '', defaultModel: '',
}

/**
 * Validate a complete non-secret settings document from IPC or disk.
 * @param input - untrusted persisted or renderer preferences.
 * @returns a detached document containing only supported preferences.
 */
export function parseDshSettings(input: unknown): DshSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid DSH settings')
  const value = input as Record<string, unknown>
  const defaultProvider = value.defaultProvider === undefined ? '' : value.defaultProvider
  const defaultModel = value.defaultModel === undefined ? '' : value.defaultModel
  if (Object.keys(value).some(key => !Object.hasOwn(DEFAULT_DSH_SETTINGS, key))
    || !['normal', 'compact'].includes(String(value.transcriptView)) || typeof value.transcriptView !== 'string'
    || typeof value.modeSelectionEnabled !== 'boolean'
    || typeof value.defaultPreset !== 'string' || !value.defaultPreset.trim() || value.defaultPreset.length > 256
    || typeof value.deepseekProtocol !== 'string' || !['messages', 'chat-completions'].includes(value.deepseekProtocol)
    || typeof value.deepseekBaseURL !== 'string' || value.deepseekBaseURL.length > 4096
    || typeof value.deepseekKeyRef !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value.deepseekKeyRef)
    || value.deepseekKeyRef.length > 256 || typeof value.deepseekMaxTokens !== 'number'
    || !Number.isSafeInteger(value.deepseekMaxTokens) || value.deepseekMaxTokens < 1
    || typeof value.reasoningEffort !== 'string' || !value.reasoningEffort.trim() || value.reasoningEffort.length > 256
    || typeof defaultProvider !== 'string' || typeof defaultModel !== 'string'
    || defaultProvider.length > 256 || defaultModel.length > 256
    || Boolean(defaultProvider.trim()) !== Boolean(defaultModel.trim())) {
    throw new Error('Invalid DSH settings')
  }
  const url = new URL(value.deepseekBaseURL)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('DSH model URL must be HTTP(S) without credentials, query, or fragment')
  }
  return { transcriptView: value.transcriptView as DshSettings['transcriptView'], modeSelectionEnabled: value.modeSelectionEnabled,
    defaultPreset: value.defaultPreset.trim(), deepseekProtocol: value.deepseekProtocol as DshSettings['deepseekProtocol'],
    deepseekBaseURL: value.deepseekBaseURL, deepseekKeyRef: value.deepseekKeyRef, deepseekMaxTokens: value.deepseekMaxTokens,
    reasoningEffort: value.reasoningEffort.trim(), defaultProvider: defaultProvider.trim(), defaultModel: defaultModel.trim() }
}
