/** Field-level projection of software preferences onto each instance's published settings schema. */
import Schema from '@deepseek-ai/schemastery'
import type { SoftwareSettingsSnapshot } from './software-settings.ts'

/** Redacted namespace metadata delivered by the instance settings API. */
export interface InstanceSettingsDocument {
  writable: boolean
  namespaces: Array<{ ns: string; revision: number; schema: unknown; value: Record<string, unknown> }>
}

/** One resolved software control; absent targets are not accepted by this instance. */
export interface SettingSupport {
  namespace: string | null
  field: string | null
  options?: string[]
  min?: number
  max?: number
  step?: number
}

/** Current instance capabilities, without retaining instance values or credential data. */
export interface InstanceSettingsSupport {
  writable: boolean
  fields: Record<string, SettingSupport>
}

/** Software control ids and their ordered instance targets; also the manager's edit allowlist. */
export const SOFTWARE_SETTING_TARGETS = {
  theme: [['ui-theme', 'preference']], fontSize: [['ui-theme', 'fontSize']],
  language: [['locale', 'preference']], busyEnter: [['ui-conversation', 'busyEnter']],
  motionEnabled: [['ui-theme', 'motionEnabled']], customization: [['ui-theme', 'customization']],
  transcriptView: [['ui-chat', 'transcriptView']], modeSelectionEnabled: [['agent-presets', 'modeSelectionEnabled']],
  defaultPreset: [['agent-presets', 'default']], deepseekProtocol: [['llm-deepseek', 'protocol']],
  deepseekBaseURL: [['llm-deepseek', 'baseURL']], deepseekKeyRef: [['llm-deepseek', 'apiKeyEnv']],
  deepseekMaxTokens: [['llm-deepseek', 'maxTokens']],
  reasoningEffort: [['agent-default-model', 'reasoningEffort'], ['llm-deepseek', 'reasoningEffort']],
  defaultProvider: [['agent-default-model', 'provider']], defaultModel: [['agent-default-model', 'model']],
} as const

/**
 * Resolve every shared control against the instance schema, validating values before transport.
 * @param preferences - Validated software choices; blank model selection retains the instance default.
 * @param document - Redacted settings descriptor from this instance.
 * @param language - Resolved software locale when the preference follows the operating system.
 * @returns Supported field metadata, grouped edits, and field-specific validation failures.
 */
export function resolveInstanceSettings(preferences: SoftwareSettingsSnapshot, document: InstanceSettingsDocument, language: string): {
  support: InstanceSettingsSupport
  edits: Array<[string, Record<string, unknown>]>
  failures: string[]
} {
  const schemas = new Map(document.namespaces.map(section => [section.ns, { section, schema: new Schema(section.schema as Schema) }]))
  const values: Record<keyof typeof SOFTWARE_SETTING_TARGETS, unknown> = { ...preferences.appearance, ...preferences.dsh,
    language: preferences.appearance.language || language, customization: preferences.personalization }
  const fields: Record<string, SettingSupport> = {}
  const edits = new Map<string, Record<string, unknown>>()
  const failures: string[] = []
  for (const [id, targets] of Object.entries(SOFTWARE_SETTING_TARGETS)) {
    const target = targets.flatMap(([namespace, field]) => {
      const entry = schemas.get(namespace)
      const schema: Schema<unknown> | undefined = entry?.schema.dict?.[field]
      return schema && entry ? [{ namespace, field, schema, section: entry.section }] : []
    })[0]
    if (!target) { fields[id] = { namespace: null, field: null }; continue }
    const { namespace, field, schema, section } = target
    const options = schema.type === 'union' && schema.list?.every(item => item.type === 'const' && typeof item.value === 'string')
      ? schema.list.map(item => String(item.value)) : undefined
    fields[id] = { namespace, field, ...options ? { options } : {},
      ...schema.meta.min === undefined ? {} : { min: schema.meta.min },
      ...schema.meta.max === undefined ? {} : { max: schema.meta.max },
      ...schema.meta.step === undefined ? {} : { step: schema.meta.step } }
    const value = values[id as keyof typeof SOFTWARE_SETTING_TARGETS]
    if ((id === 'defaultProvider' || id === 'defaultModel') && value === '') continue
    try {
      const accepted: unknown = schema(value)
      if (JSON.stringify(section.value[field]) === JSON.stringify(accepted)) continue
      if (!document.writable) { failures.push(`${namespace}.${field}: instance settings are read-only`); continue }
      const group = edits.get(namespace) ?? {}
      group[field] = accepted
      edits.set(namespace, group)
    } catch (error) {
      failures.push(`${namespace}.${field}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { support: { writable: document.writable, fields }, edits: [...edits], failures }
}
