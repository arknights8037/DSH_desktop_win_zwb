/* Model source forms save through the software; instance values never populate them. */
let sourceEditing
const sourceProtocols = {
  'openai-completions': 'openaiCompletions', 'openai-responses': 'openaiResponses', 'anthropic-messages': 'anthropicMessages',
}
function renderSources() {
  const sources = softwareDocument?.modelSources || []
  $('sources-empty').hidden = sources.length > 0 || !$('source-form').hidden
  $('source-add').disabled = !softwareDocument || softwareSaving
  const signature = JSON.stringify([sources, softwareSaving, state.messages])
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
      actions.append(edit, remove, cancel)
      row.append(description, actions)
      return row
    }))
  }
  document.querySelectorAll('#source-form input, #source-form select, #source-form textarea, #source-form button').forEach(input => {
    input.disabled = !softwareDocument || softwareSaving
  })
}
function editSource(source) {
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
  $('source-key-hint').textContent = t(source?.keyConfigured ? 'sourceKeyKeep' : 'sourceKeyRequired')
  $('source-form').hidden = false
  $('sources-empty').hidden = true
  $('source-name').focus()
}
function closeSourceForm() {
  sourceEditing = undefined
  $('source-form').hidden = true
  $('source-key').value = ''
  $('sources-empty').hidden = Boolean(softwareDocument?.modelSources.length)
}
$('source-add').onclick = () => editSource()
$('source-cancel').onclick = closeSourceForm
$('source-form').onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); closeSourceForm() } }
$('source-form').onsubmit = event => {
  event.preventDefault()
  const config = { name: $('source-name').value.trim(), protocol: $('source-protocol').value, baseURL: $('source-url').value.trim(),
    models: $('source-models').value.split(/[\n,，]/u).map(value => value.trim()).filter(Boolean),
    contextWindow: Number($('source-context').value), maxTokens: Number($('source-max-tokens').value) }
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
