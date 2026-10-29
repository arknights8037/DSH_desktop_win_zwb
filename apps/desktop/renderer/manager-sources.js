/* Model source forms save through the software; instance values never populate them. */
let sourceEditing
let sourceGeneration = 0
let sourceFetching = false
let sourceHasKey = false
const sourceTemplates = {
  openai: ['providerOpenAI', 'openai-responses', 'https://api.openai.com/v1'],
  anthropic: ['providerAnthropic', 'anthropic-messages', 'https://api.anthropic.com'],
  deepseek: ['providerDeepSeek', 'openai-completions', 'https://api.deepseek.com/v1'],
  gemini: ['providerGemini', 'openai-completions', 'https://generativelanguage.googleapis.com/v1beta/openai'],
  openrouter: ['providerOpenRouter', 'openai-completions', 'https://openrouter.ai/api/v1'],
  qwen: ['providerQwen', 'openai-completions', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
  moonshot: ['providerMoonshot', 'openai-completions', 'https://api.moonshot.cn/v1'],
  ollama: ['providerOllama', 'openai-completions', 'http://localhost:11434/v1'],
}
const sourceProtocols = {
  'openai-completions': 'openaiCompletions', 'openai-responses': 'openaiResponses', 'anthropic-messages': 'anthropicMessages',
}
function renderSources() {
  const sources = softwareDocument?.modelSources || []
  $('sources-empty').hidden = sources.length > 0 || !$('source-form').hidden
  $('source-add').disabled = !softwareDocument || softwareSaving
  const signature = JSON.stringify([sources, softwareDocument?.dsh, softwareSaving, state.messages])
  if ($('model-sources').dataset.signature !== signature) {
    $('model-sources').dataset.signature = signature
    $('model-sources').replaceChildren(...sources.map(source => {
      const row = document.createElement('div')
      row.className = 'model-source'
      row.dataset.sourceId = source.id
      const description = document.createElement('div')
      const name = document.createElement('strong')
      name.textContent = source.name
      const detail = document.createElement('p')
      detail.textContent = `${t(sourceProtocols[source.protocol])} · ${source.models.join(', ')} · ${t(source.keyConfigured ? 'keyConfigured' : 'keyMissing')}`
      const url = document.createElement('p')
      url.textContent = source.baseURL
      description.append(name, detail, url)
      const actions = document.createElement('div')
      actions.className = 'source-actions'
      const model = document.createElement('select')
      model.setAttribute('aria-label', t('defaultModelId'))
      for (const id of source.models) {
        const option = document.createElement('option')
        option.value = option.textContent = id
        model.append(option)
      }
      const route = `desktop-${source.id}`
      if (softwareDocument.dsh.defaultProvider === route) model.value = softwareDocument.dsh.defaultModel
      if (!model.value) model.selectedIndex = 0
      const use = document.createElement('button')
      use.textContent = t('useModel')
      use.disabled = softwareSaving
      use.onclick = () => { void perform(async () => {
        softwareSaving = true
        const selected = model.value
        renderSettings()
        try { await settingsCall('dshUpdate', { value: { ...softwareDocument.dsh, defaultProvider: route, defaultModel: selected } }) }
        finally { softwareSaving = false; await loadSoftwareSettings() }
      }) }
      const edit = document.createElement('button')
      edit.textContent = t('edit')
      edit.disabled = softwareSaving
      edit.onclick = () => editSource(source)
      const remove = document.createElement('button')
      remove.textContent = t('removeSource')
      remove.disabled = softwareSaving
      const cancel = document.createElement('button')
      cancel.textContent = t('cancel')
      cancel.hidden = true
      cancel.onclick = () => { remove.dataset.confirm = ''; remove.textContent = t('removeSource'); cancel.hidden = true }
      remove.onclick = () => {
        if (!remove.dataset.confirm) {
          remove.dataset.confirm = 'true'
          remove.textContent = t('confirmRemoveSource')
          cancel.hidden = false
          return
        }
        void perform(async () => {
          softwareSaving = true
          renderSettings()
          try {
            await settingsCall('sourceRemove', { id: source.id })
            if (sourceEditing === source.id) closeSourceForm()
          } finally { softwareSaving = false; await loadSoftwareSettings() }
        })
      }
      actions.append(edit, remove, cancel, model, use)
      row.append(description, actions)
      return row
    }))
  }
  document.querySelectorAll('#source-form input, #source-form select, #source-form textarea, #source-form button').forEach(input => {
    input.disabled = !softwareDocument || softwareSaving
  })
  $('source-fetch').disabled = !softwareDocument || softwareSaving || sourceFetching
  $('source-key').disabled = !softwareDocument?.credentialWritable || softwareSaving || $('source-key-field').hidden
}
function editSource(source) {
  sourceGeneration++
  sourceFetching = false
  sourceHasKey = Boolean(source?.keyConfigured)
  $('source-template').value = Object.entries(sourceTemplates).find(([, template]) => template[1] === source?.protocol && template[2] === source?.baseURL)?.[0] || 'custom'
  $('source-catalog-field').hidden = true
  $('source-catalog').replaceChildren()
  sourceEditing = source?.id
  $('source-form-title').textContent = t(source ? 'editSource' : 'addSource')
  $('source-name').value = source?.name || ''
  $('source-protocol').value = source?.protocol || 'openai-completions'
  $('source-url').value = source?.baseURL || ''
  $('source-models').value = source?.models.join('\n') || ''
  $('source-context').value = String(source?.contextWindow || 262144)
  $('source-max-tokens').value = String(source?.maxTokens || 32768)
  $('source-key').value = ''
  $('source-key').required = !source?.keyConfigured
  $('source-key-field').hidden = sourceHasKey
  $('source-key-replace').hidden = !sourceHasKey
  $('source-fetch-status').textContent = ''
  $('source-form').hidden = false
  $('sources-empty').hidden = true
  $('source-name').focus()
  renderSources()
  if (sourceHasKey) void fetchSourceModels()
}
function closeSourceForm() {
  sourceGeneration++
  sourceFetching = false
  sourceEditing = undefined
  $('source-form').hidden = true
  $('source-key').value = ''
  $('sources-empty').hidden = Boolean(softwareDocument?.modelSources.length)
}
$('source-key-replace').onclick = () => {
  $('source-key-field').hidden = false
  $('source-key-replace').hidden = true
  renderSources()
  $('source-key').focus()
}
function sourceConfig() {
  return { name: $('source-name').value.trim(), protocol: $('source-protocol').value, baseURL: $('source-url').value.trim(),
    models: [...new Set($('source-models').value.split(/[\n,，]/u).map(value => value.trim()).filter(Boolean))],
    contextWindow: Number($('source-context').value), maxTokens: Number($('source-max-tokens').value) }
}
async function fetchSourceModels() {
  const config = sourceConfig()
  if (!config.baseURL || !$('source-url').checkValidity() || !($('source-key').value || sourceHasKey)) return
  const generation = ++sourceGeneration
  const previousModels = $('source-models').value
  sourceFetching = true
  $('source-fetch-status').textContent = t('sourceFetching')
  renderSources()
  try {
    const models = await settingsCall('sourceModels', { ...(sourceEditing ? { id: sourceEditing } : {}),
      config: { ...config, name: config.name || 'API', models: config.models.length ? config.models : ['discovery'] }, key: $('source-key').value })
    if (generation !== sourceGeneration) return
    if ($('source-models').value === previousModels && !previousModels.trim() && models.length <= 256) $('source-models').value = models.join('\n')
    const selected = new Set(sourceConfig().models)
    $('source-catalog').replaceChildren(...models.map(id => {
      const option = document.createElement('option')
      option.value = option.textContent = id; option.selected = selected.has(id)
      return option
    }))
    $('source-catalog-field').hidden = false
    $('source-fetch-status').textContent = `${t('sourceFetched')} (${models.length})`
  } catch {
    if (generation === sourceGeneration) $('source-fetch-status').textContent = t('sourceFetchFailed')
  } finally {
    if (generation === sourceGeneration) { sourceFetching = false; renderSources() }
  }
}
$('source-catalog').onchange = () => { $('source-models').value = [...$('source-catalog').selectedOptions].map(option => option.value).join('\n') }
$('source-template').onchange = () => {
  const template = sourceTemplates[$('source-template').value]
  if (!template) return
  sourceGeneration++; sourceFetching = false
  $('source-name').value = t(template[0]); $('source-protocol').value = template[1]; $('source-url').value = template[2]
  $('source-models').value = ''; $('source-catalog-field').hidden = true; $('source-fetch-status').textContent = ''
  $('source-context').value = '128000'; $('source-max-tokens').value = '4096'
  // A provider switch needs its own key, even when the form edits an existing source.
  sourceHasKey = false; $('source-key').value = $('source-template').value === 'ollama' ? 'ollama' : ''
  $('source-key').required = true; $('source-key-field').hidden = false; $('source-key-replace').hidden = true
  renderSources()
  if ($('source-key').value) void fetchSourceModels()
}
$('source-fetch').onclick = () => { void fetchSourceModels() }
for (const id of ['source-url', 'source-protocol', 'source-key']) {
  $(id).onchange = () => { void fetchSourceModels() }
  $(id).oninput = () => { sourceGeneration++; sourceFetching = false; $('source-fetch-status').textContent = ''; renderSources() }
}
$('source-add').onclick = () => editSource()
$('source-cancel').onclick = closeSourceForm
$('source-form').onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); closeSourceForm() } }
$('source-form').onsubmit = event => {
  event.preventDefault()
  const config = sourceConfig()
  const key = $('source-key').value
  $('source-key').value = ''
  const input = { ...(sourceEditing ? { id: sourceEditing } : {}), config, key }
  void perform(async () => {
    softwareSaving = true
    renderSettings()
    try { await settingsCall('sourceSave', input); closeSourceForm() }
    finally { softwareSaving = false; await loadSoftwareSettings() }
  })
}
