/** Settings API descriptors for independently versioned instance fixtures. */
import Schema from '@deepseek-ai/schemastery'
import { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import { Config as DeepSeekSchema } from '@deepseek-ai/dsh-llm-deepseek'
import { volatileForm } from '../../../packages/settings/settings/src/schema.ts'
import type { InstanceSettingsDocument } from '../src/settings-adapter.ts'

/**
 * Build wire schemas with deliberately different values, using the model owners' current schemas.
 * @returns A detached, writable legacy settings document.
 */
export function legacySettingsDocument(): InstanceSettingsDocument {
  const rows: Array<[string, Schema, Record<string, unknown>, number]> = [
    ['ui-theme', Schema.object({ preference: Schema.union(['system', 'light', 'dark']),
      fontSize: Schema.number().min(12).max(17).step(1), customization: Schema.any() }), { preference: 'dark', fontSize: 12 }, 4],
    ['locale', Schema.object({ preference: Schema.union(['', 'zh', 'en']).default('') }), { preference: 'zh' }, 2],
    ['ui-conversation', Schema.object({ busyEnter: Schema.union(['queue', 'steer']) }), { busyEnter: 'steer' }, 3],
    ['llm-pi-ai', Schema.object({ providers: Schema.dict(Schema.object({})) }), { providers: { unrelated: { api: 'openai-completions' } } }, 0],
    ['ui-chat', Schema.object({ transcriptView: Schema.union(['normal', 'compact']) }), { transcriptView: 'normal' }, 1],
    ['agent-presets', Schema.object({ default: Schema.string(), modeSelectionEnabled: Schema.boolean() }), { default: 'instance-preset', modeSelectionEnabled: false }, 1],
    ['llm-deepseek', volatileForm(DeepSeekSchema)!, { baseURL: 'https://instance.test', unrelated: true }, 1],
  ]
  return { writable: true, namespaces: rows.map(([ns, schema, value, revision]) => ({ ns, schema: schema.toJSON(), value, revision })) }
}

/**
 * Add current default-model settings without removing independently supported legacy fields.
 * @returns A writable document containing both generations of namespaces.
 */
export function mixedSettingsDocument(): InstanceSettingsDocument {
  const document = legacySettingsDocument()
  document.namespaces.push({ ns: 'agent-default-model', schema: volatileForm(AgentDefaultModelConfig.Config)!.toJSON(),
    value: { provider: 'deepseek', model: 'deepseek-chat' }, revision: 5 })
  return document
}
