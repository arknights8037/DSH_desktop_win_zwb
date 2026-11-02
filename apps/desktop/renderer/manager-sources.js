/* Third-party providers map directly to DSH llm-pi-ai provider profiles. */
let sourceEditing
let sourceHasKey = false
let sourceFetching = false
let sourceGeneration = 0
const sourceProtocols = {
  'openai-completions': 'openaiCompletions',
  'openai-responses': 'openaiResponses',
  'anthropic-messages': 'anthropicMessages',
}

function sourceRoute(source) { return `desktop-${source.id}` }

function renderSources() {
  const sources = softwareDocument?.modelSources || []
  const formOpen = !$('source-form').hidden
  $('sources-empty').hidden = sources.length > 0 || formOpen
  $('source-add').disabled = !softwareDocument || softwareSaving
  const signature = JSON.stringify([sources, softwareDocument?.dsh, softwareSaving, state.messages])
  if ($('model-sources').dataset.signature !== signature) {
    $('model-sources').dataset.signature = signature
    $('model-sources').replaceChildren(...sources.map(source => {
      const row = document.createElement('article')
      row.className = 'provider-row'
      const route = sourceRoute(source)
      const isDefault = softwareDocument.dsh.defaultProvider === route
      row.classList.toggle('is-default', isDefault)

      const summary = document.createElement('div')
      summary.className = 'provider-summary'
      const title = document.createElement('div')
      title.className = 'provider-title'
      const name = document.createElement('strong')
      name.textContent = source.name
      const protocol = document.createElement('span')
      protocol.className = 'provider-protocol'
      protocol.textContent = t(sourceProtocols[source.protocol])
      title.append(name, protocol)
      const url = document.createElement('span')
      url.className = 'provider-url'
      url.textContent = source.baseURL
      const meta = document.createElement('span')
      meta.className = 'provider-meta'
      meta.textContent = `${t('sourceModelCount').replace('{count}', String(source.models.length))} · ${t(source.keyConfigured ? 'keyConfigured' : 'keyMissing')}`
      summary.append(title, url, meta)

      const actions = document.createElement('div')
      actions.className = 'provider-actions'
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
          } finally {
            softwareSaving = false
            await loadSoftwareSettings()
          }
        })
      }
      actions.append(edit, remove, cancel)

      const defaultRow = document.createElement('div')
      defaultRow.className = 'provider-default-row'
      const modelLabel = document.createElement('label')
      const modelLabelText = document.createElement('span')
      modelLabelText.textContent = t('defaultModelId')
      const model = document.createElement('select')
      for (const id of source.models) {
        const option = document.createElement('option')
        option.value = option.textContent = id
        model.append(option)
      }
      if (isDefault) model.value = softwareDocument.dsh.defaultModel
      if (!model.value) model.selectedIndex = 0
      modelLabel.append(modelLabelText, model)
      const use = document.createElement('button')
      use.textContent = isDefault ? t('currentDefault') : t('useModel')
      use.disabled = softwareSaving || isDefault
      use.onclick = () => { void perform(async () => {
        softwareSaving = true
        renderSettings()
        try {
          await settingsCall('dshUpdate', {
            value: { ...softwareDocument.dsh, defaultProvider: route, defaultModel: model.value },
          })
        } finally {
          softwareSaving = false
          await loadSoftwareSettings()
        }
      }) }
      defaultRow.append(modelLabel, use)
      row.append(summary, actions, defaultRow)
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
  sourceEditing = source?.id
  $('source-form-title').textContent = t(source ? 'editProvider' : 'addProvider')
  $('source-name').value = source?.name || ''
  $('source-protocol').value = source?.protocol || 'openai-completions'
  $('source-url').value = source?.baseURL || ''
  $('source-models').value = source?.models.join('\n') || ''
  $('source-context').value = String(source?.contextWindow || 262144)
  $('source-max-tokens').value = String(source?.maxTokens || 32768)
  $('source-key').value = ''
  $('source-key').required = !sourceHasKey
  $('source-key-field').hidden = sourceHasKey
  $('source-key-replace').hidden = !sourceHasKey
  $('source-key-status').textContent = t(sourceHasKey ? 'keyConfigured' : 'keyMissing')
  $('source-fetch-status').textContent = ''
  $('source-form').hidden = false
  $('sources-empty').hidden = true
  renderSources()
  reportDirty()
  $('source-name').focus()
}

function closeSourceForm() {
  sourceGeneration++
  sourceFetching = false
  sourceEditing = undefined
  sourceHasKey = false
  $('source-key').value = ''
  $('source-form').hidden = true
  $('sources-empty').hidden = Boolean(softwareDocument?.modelSources.length)
  renderSources()
  reportDirty()
}

function sourceConfig() {
  return {
    name: $('source-name').value.trim(),
    protocol: $('source-protocol').value,
    baseURL: $('source-url').value.trim(),
    models: [...new Set($('source-models').value.split(/[\n,，]/u).map(value => value.trim()).filter(Boolean))],
    contextWindow: Number($('source-context').value),
    maxTokens: Number($('source-max-tokens').value),
  }
}

async function fetchSourceModels() {
  const config = sourceConfig()
  if (!config.baseURL || !$('source-url').checkValidity() || !($('source-key').value || sourceHasKey || sourceEditing)) {
    $('source-fetch-status').textContent = t('sourceFetchNeedsConnection')
    return
  }
  const generation = ++sourceGeneration
  sourceFetching = true
  $('source-fetch-status').textContent = t('sourceFetching')
  renderSources()
  try {
    const models = await settingsCall('sourceModels', {
      ...(sourceEditing ? { id: sourceEditing } : {}),
      config: {
        ...config,
        name: config.name || 'API',
        models: config.models.length ? config.models : ['discovery'],
      },
      key: $('source-key').value,
    })
    if (generation !== sourceGeneration) return
    const ids = models.slice(0, 256).filter(id => typeof id === 'string' && id.trim()).map(id => id.trim())
    $('source-models').value = ids.join('\n')
    $('source-fetch-status').textContent = ids.length ? `${t('sourceFetched')} (${ids.length})` : t('sourceFetchFailed')
  } catch (error) {
    if (generation === sourceGeneration) {
      const detail = error instanceof Error ? error.message : String(error)
      $('source-fetch-status').textContent = `${t('sourceFetchFailed')}: ${detail}`
    }
  } finally {
    if (generation === sourceGeneration) {
      sourceFetching = false
      renderSources()
    }
  }
}

$('source-add').onclick = () => editSource()
$('source-cancel').onclick = closeSourceForm
$('source-fetch').onclick = () => { void fetchSourceModels() }
$('source-key-replace').onclick = () => {
  $('source-key-field').hidden = false
  $('source-key-replace').hidden = true
  $('source-key-status').textContent = t('replacingKey')
  renderSources()
  $('source-key').focus()
}
$('source-form').onkeydown = event => {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSourceForm()
  }
}
$('source-form').oninput = reportDirty
$('source-form').onsubmit = event => {
  event.preventDefault()
  const config = sourceConfig()
  const key = $('source-key').value
  void perform(async () => {
    softwareSaving = true
    renderSettings()
    try {
      await settingsCall('sourceSave', { ...(sourceEditing ? { id: sourceEditing } : {}), config, key })
      closeSourceForm()
    } finally {
      softwareSaving = false
      await loadSoftwareSettings()
    }
  })
}
