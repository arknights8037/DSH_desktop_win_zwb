/** Regression coverage for schema-based mapping across independently composed kernels. */
import Schema from '@deepseek-ai/schemastery'
import { expect, it } from 'vitest'
import { resolveInstanceSettings } from '../src/settings-adapter.ts'
import { DEFAULT_DSH_SETTINGS } from '../src/dsh-settings.ts'
import { DEFAULT_SHORTCUTS } from '../src/manager-shortcuts.ts'
import { DEFAULT_PERSONAL_APPEARANCE } from '../src/personal-appearance.ts'
import type { SoftwareSettingsSnapshot } from '../src/software-settings.ts'
import { legacySettingsDocument, mixedSettingsDocument } from './settings-fixtures.ts'

function preferences(): SoftwareSettingsSnapshot {
  return { revision: 0, debugMode: false, appearance: { theme: 'light', fontSize: 16, language: '', busyEnter: 'queue', motionEnabled: true },
    personalization: structuredClone(DEFAULT_PERSONAL_APPEARANCE), dsh: { ...DEFAULT_DSH_SETTINGS },
    shortcuts: { ...DEFAULT_SHORTCUTS }, credentials: [], credentialWritable: true, modelSources: [] }
}

it('maps coexisting namespaces by field and keeps model reasoning separate from provider defaults', () => {
  const value = preferences()
  value.dsh.defaultProvider = 'custom-provider'
  value.dsh.defaultModel = 'custom-model'
  value.dsh.reasoningEffort = 'medium'
  const result = resolveInstanceSettings(value, mixedSettingsDocument(), 'en')
  const edits = Object.fromEntries(result.edits)
  expect(result.failures).toEqual([])
  expect(edits['ui-theme']).toMatchObject({ preference: 'light', fontSize: 16, customization: value.personalization })
  expect(edits['ui-chat']).toEqual({ transcriptView: 'compact' })
  expect(edits['agent-presets']).toEqual({ default: 'standard', modeSelectionEnabled: true })
  expect(edits['agent-default-model']).toEqual({ provider: 'custom-provider', model: 'custom-model', reasoningEffort: 'medium' })
  expect(edits['llm-deepseek']).toMatchObject({ baseURL: value.dsh.deepseekBaseURL })
  expect(result.support.fields.deepseekProtocol).toEqual({ namespace: null, field: null })
  expect(edits['llm-deepseek']).not.toHaveProperty('reasoningEffort')
  expect(result.support.fields.reasoningEffort).toMatchObject({ namespace: 'agent-default-model', field: 'reasoningEffort' })
})

it('reports missing controls without writing invented fields and leaves an unspecified model untouched', () => {
  const document = mixedSettingsDocument()
  document.namespaces = document.namespaces.filter(section => section.ns !== 'ui-chat')
  const result = resolveInstanceSettings(preferences(), document, 'zh')
  expect(result.support.fields.transcriptView).toEqual({ namespace: null, field: null })
  expect(result.support.fields.motionEnabled).toEqual({ namespace: null, field: null })
  expect(Object.fromEntries(result.edits)['agent-default-model']).toEqual({ reasoningEffort: 'high' })
  expect(Object.fromEntries(result.edits)).not.toHaveProperty('ui-chat')
  expect(result.failures).toEqual([])
})

it('uses published options and limits, and refuses invalid values before sending a namespace mutation', () => {
  const document = legacySettingsDocument()
  const section = document.namespaces.find(item => item.ns === 'llm-deepseek')!
  section.schema = Schema.object({ protocol: Schema.union(['messages']), maxTokens: Schema.number().min(1).max(8192).step(1) }).toJSON()
  const result = resolveInstanceSettings(preferences(), document, 'en')
  expect(result.support.fields.deepseekProtocol).toMatchObject({ options: ['messages'] })
  expect(result.support.fields.deepseekMaxTokens).toMatchObject({ max: 8192, min: 1, step: 1 })
  expect(result.support.fields.deepseekBaseURL!.namespace).toBeNull()
  expect(result.failures).toEqual([expect.stringContaining('llm-deepseek.maxTokens')])
  expect(Object.fromEntries(result.edits)['llm-deepseek']).toEqual({ protocol: 'messages' })
})

it('preserves read-only instances and emits no writes for already applied software choices', () => {
  const value = preferences()
  const document = mixedSettingsDocument()
  const first = resolveInstanceSettings(value, document, 'en')
  for (const [namespace, edits] of first.edits) Object.assign(document.namespaces.find(item => item.ns === namespace)!.value, edits)
  expect(resolveInstanceSettings(value, document, 'en').edits).toEqual([])
  value.appearance.fontSize = 17
  document.writable = false
  const refused = resolveInstanceSettings(value, document, 'en')
  expect(refused.support.writable).toBe(false)
  expect(refused.edits).toEqual([])
  expect(refused.failures).toEqual(['ui-theme.fontSize: instance settings are read-only'])
})
