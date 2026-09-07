const { contextBridge, ipcRenderer } = require('electron');
ipcRenderer.send('window:preload-ready');

contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({
  memory: Object.freeze({
    load: (workspace, session) => ipcRenderer.invoke('memory:load', workspace, session),
    add: (scope, key, text) => ipcRenderer.invoke('memory:add', scope, key, text),
    remove: (scope, key, id) => ipcRenderer.invoke('memory:remove', scope, key, id),
    clear: (scope, key) => ipcRenderer.invoke('memory:clear', scope, key),
    export: (workspace, session) => ipcRenderer.invoke('memory:export', workspace, session)
  }),
  integrations: Object.freeze({
    load: () => ipcRenderer.invoke('integrations:load'),
    pickSkillDirectory: () => ipcRenderer.invoke('integrations:pick-skill-directory'),
    importSkill: (address) => ipcRenderer.invoke('integrations:import-skill', address),
    removeImportedSkill: (id) => ipcRenderer.invoke('integrations:remove-imported-skill', id),
    save: (state) => ipcRenderer.invoke('integrations:save', state),
    restart: () => ipcRenderer.invoke('integrations:restart')
  }),
  projectGit: Object.freeze({
    read: (request) => ipcRenderer.invoke('project-git:read', request),
    inspect: (workspacePath) => ipcRenderer.invoke('project-git:inspect', workspacePath),
    execute: (request) => ipcRenderer.invoke('project-git:execute', request)
  })
}));

const TITLEBAR_HEIGHT = 38;

function setWindowControlIcon(element, action, maximized = false) {
  const paths = action === 'minimize'
    ? '<path d="M3 8.5h10" />'
    : action === 'toggle-maximize' && maximized
      ? '<path d="M5.5 3H13v7.5" /><path d="M3 5.5h7.5V13H3z" />'
      : action === 'toggle-maximize'
        ? '<rect x="3" y="3" width="10" height="10" />'
        : '<path d="m3.5 3.5 9 9m0-9-9 9" />';
  element.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${paths}</svg>`;
}

function button(label, title, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `dsh-window-button ${className}`.trim();
  element.setAttribute('aria-label', label);
  element.title = title;
  element.dataset.windowAction = action;
  setWindowControlIcon(element, action);
  element.addEventListener('click', () => ipcRenderer.invoke(`window:${action}`));
  return element;
}

function installWindowChrome() {
  if (document.querySelector('.dsh-desktop-titlebar')) return;

  const style = document.createElement('style');
  style.textContent = `
    :root.dsh-window-chrome,
    :root.dsh-window-chrome body {
      --dsh-window-titlebar-height: ${TITLEBAR_HEIGHT}px;
    }
    html.dsh-window-chrome body {
      padding-top: var(--dsh-window-titlebar-height) !important;
      box-sizing: border-box !important;
    }
    html.dsh-window-chrome body > .dsh-desktop-titlebar {
      position: fixed;
      z-index: 2147483647;
      inset: 0 0 auto 0;
      height: var(--dsh-window-titlebar-height);
      display: flex;
      align-items: center;
      gap: 0;
      box-sizing: border-box;
      padding: 0 8px 0 14px;
      color: #e9edf5;
      background: #171a21;
      border-bottom: 1px solid #2d333d;
      -webkit-app-region: drag;
      user-select: none;
      font-family: "Segoe UI", system-ui, sans-serif;
    }
    .dsh-window-brand {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .02em;
      opacity: .92;
    }
    .dsh-window-spacer { flex: 1; }
    .dsh-window-button {
      width: 46px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: 0;
      color: #dbe1ea;
      background: transparent;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    .dsh-window-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.25; stroke-linecap: square; }
    .dsh-window-button:hover { background: #2a303a; }
    .dsh-window-button:focus-visible {
      outline: 2px solid #71a7ff;
      outline-offset: -2px;
    }
    .dsh-window-button.dsh-window-close:hover {
      color: #fff;
      background: #c42b3c;
    }
  `;
  document.head.appendChild(style);
  document.documentElement.classList.add('dsh-window-chrome');

  const titlebar = document.createElement('header');
  titlebar.className = 'dsh-desktop-titlebar';
  titlebar.setAttribute('role', 'toolbar');
  titlebar.setAttribute('aria-label', 'Window controls');

  const brand = document.createElement('span');
  brand.className = 'dsh-window-brand';
  brand.textContent = 'DeepSeek Harness Desktop';
  titlebar.appendChild(brand);

  const spacer = document.createElement('span');
  spacer.className = 'dsh-window-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  titlebar.appendChild(spacer);

  titlebar.appendChild(button('Minimize window', 'Minimize', 'minimize'));
  const maximize = button('Maximize window', 'Maximize', 'toggle-maximize');
  maximize.classList.add('dsh-window-maximize');
  titlebar.appendChild(maximize);
  titlebar.appendChild(button('Close window', 'Close', 'close', 'dsh-window-close'));

  titlebar.addEventListener('dblclick', (event) => {
    if (event.target === titlebar || event.target === brand || event.target === spacer) {
      ipcRenderer.invoke('window:toggle-maximize');
    }
  });
  document.body.prepend(titlebar);

  ipcRenderer.on('window:state', (_event, state) => {
    const maximized = state?.maximized === true;
    maximize.setAttribute('aria-label', maximized ? 'Restore window' : 'Maximize window');
    maximize.title = maximized ? 'Restore' : 'Maximize';
    setWindowControlIcon(maximize, 'toggle-maximize', maximized);
  });
}

function featureNavigationButton(kind, label, icon, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `dsh-sidebar-feature dsh-sidebar-feature-${kind}`;
  element.setAttribute('aria-label', label);
  element.title = label;
  element.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${icon}</svg><span class="dsh-sidebar-feature-label">${label}</span>`;
  element.addEventListener('click', onClick);
  return element;
}

function installFeaturePageNavigation() {
  if (document.querySelector('#dsh-feature-navigation-style')) return;

  const style = document.createElement('style');
  style.id = 'dsh-feature-navigation-style';
  style.textContent = `
    .dsh-sidebar-feature {
      box-sizing: border-box;
      display: flex;
      width: calc(100% - 4px);
      height: 38px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin: 0 2px 8px;
      padding: 8px 16px;
      border: .666667px solid rgba(0, 0, 0, .1);
      border-radius: 12px;
      color: var(--dsw-alias-label-primary, #0f1115);
      background: var(--dsw-alias-background-primary, #fff);
      cursor: pointer;
      font: 500 14px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .dsh-sidebar-feature:hover { background: var(--dsw-alias-fill-secondary, #f1f3f5); }
    .dsh-sidebar-feature:focus-visible { outline: 2px solid #4d8dff; outline-offset: 2px; }
    .dsh-sidebar-feature svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
    .dsh-sidebar-feature-memory {
      width: calc(100% + 4px);
      height: 42px;
      justify-content: flex-start;
      margin: 4px -2px;
      padding: 0 10px 0 8px;
      border: 0;
      background: transparent;
      font-weight: 400;
    }
    .dsh-sidebar-feature-memory:hover { background: var(--dsw-alias-fill-secondary, #f1f3f5); }
    .dsh-feature-page {
      position: fixed;
      z-index: 2147483645;
      top: var(--dsh-window-titlebar-height);
      right: 0;
      bottom: 0;
      left: var(--dsh-feature-page-left, 0px);
      width: auto;
      max-height: none;
      box-sizing: border-box;
      border: 0;
      border-radius: 0;
      box-shadow: none;
    }
  `;
  document.head.appendChild(style);

  const pluginIcon = '<path d="M6.25 2.5v3.75H2.5V9.75h3.75v3.75h3.5V9.75h3.75v-3.5H9.75V2.5z" /><path d="M7 8h2" />';
  const memoryIcon = '<path d="M3 3.5h7.5a2.5 2.5 0 0 1 2.5 2.5v6.5H5.5A2.5 2.5 0 0 0 3 15z" /><path d="M3 3.5v11.5" />';
  let scheduled = false;
  const mount = () => {
    scheduled = false;
    const newSession = document.querySelector('button.hHd-Xa_newSession');
    if (newSession && !document.querySelector('.dsh-sidebar-feature-plugin')) {
      newSession.insertAdjacentElement('afterend', featureNavigationButton('plugin', '插件', pluginIcon, openPluginManager));
    }
    const settingsArea = document.querySelector('.hHd-Xa_settingsArea');
    if (settingsArea && !document.querySelector('.dsh-sidebar-feature-memory')) {
      settingsArea.prepend(featureNavigationButton('memory', '记忆', memoryIcon, openMemoryManager));
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(mount, 0);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  mount();
}

function openMemoryManager() {
  let panel = document.querySelector('.dsh-memory-manager');
  if (panel) {
    closeFeaturePage(panel, document.querySelector('style[data-dsh-memory-page]'));
    return;
  }
  const workspace = document.querySelector('[role="treeitem"][aria-expanded] [class*="projectText"], [role="treeitem"][aria-expanded] [class*="title"]')?.textContent?.trim() || 'default';
  const session = document.querySelector('[role="treeitem"][draggable="true"][aria-selected="true"] [class*="title"], [role="treeitem"][draggable="true"] [class*="title"]')?.textContent?.trim() || 'default';
  const sessionKey = `${workspace}::${session}`;
  panel = document.createElement('section');
  panel.className = 'dsh-memory-manager dsh-feature-page';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `<div class="dsh-memory-header"><strong>分层记忆</strong><button type="button" class="dsh-memory-close" aria-label="Close memory manager">\u00d7</button></div><div class="dsh-memory-toolbar"><button type="button" data-scope="system">系统</button><button type="button" data-scope="project">项目</button><button type="button" data-scope="session">会话</button><button type="button" class="dsh-memory-export">导出</button></div><textarea class="dsh-memory-input" rows="3" placeholder="添加一条记忆"></textarea><div class="dsh-memory-actions"><button type="button" class="dsh-memory-add">添加</button><button type="button" class="dsh-memory-clear">清空当前层</button></div><p class="dsh-memory-status" aria-live="polite">系统 > 项目 > 会话</p><div class="dsh-memory-list"></div>`;
  const style = document.createElement('style');
  style.dataset.dshMemoryPage = 'true';
  style.textContent = `.dsh-memory-manager{overflow:auto;padding:24px;color:#e9edf5;background:#1b2028;font:13px/1.4 "Segoe UI",system-ui,sans-serif}.dsh-memory-header,.dsh-memory-toolbar,.dsh-memory-actions{display:flex;align-items:center;gap:8px;padding:10px 14px}.dsh-memory-header{border-bottom:1px solid #303945;font-size:15px}.dsh-memory-header strong{flex:1}.dsh-memory-close{width:28px;height:28px;color:#dbe1ea;background:transparent;border:0;font-size:20px;cursor:pointer}.dsh-memory-toolbar{flex-wrap:wrap;border-bottom:1px solid #303945}.dsh-memory-toolbar button,.dsh-memory-actions button{border:1px solid #465160;border-radius:5px;padding:6px 10px;color:#e9edf5;background:#252c36;cursor:pointer;font:inherit}.dsh-memory-toolbar button[data-active="true"]{border-color:#71a7ff;color:#a9c8ff}.dsh-memory-input{display:block;box-sizing:border-box;width:calc(100% - 28px);margin:12px 14px 0;padding:8px;color:#e9edf5;background:#202630;border:1px solid #465160;border-radius:5px;resize:vertical;font:inherit}.dsh-memory-status{margin:0;padding:0 14px 8px;color:#9ca8b8}.dsh-memory-list{display:grid;gap:7px;padding:0 14px 14px}.dsh-memory-entry{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid #303945;border-radius:5px;background:#202630}.dsh-memory-entry span{flex:1;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-memory-entry button{color:#f0a5ad;background:transparent;border:0;cursor:pointer}`;
  document.head.appendChild(style); document.body.appendChild(panel); makeFeaturePage(panel);
  const list = panel.querySelector('.dsh-memory-list'); const status = panel.querySelector('.dsh-memory-status'); let scope = 'system'; let catalog;
  const keyFor = () => scope === 'system' ? '' : scope === 'project' ? (catalog?.projectKey || workspace) : (catalog?.sessionKey || sessionKey);
  const entriesFor = () => scope === 'system' ? catalog?.state?.system || [] : scope === 'project' ? catalog?.state?.projects?.[catalog?.projectKey || workspace] || [] : catalog?.state?.sessions?.[catalog?.sessionKey || sessionKey] || [];
  const render = () => { list.replaceChildren(); for (const entry of entriesFor()) { const row = document.createElement('div'); row.className = 'dsh-memory-entry'; const text = document.createElement('span'); text.textContent = entry.text; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.addEventListener('click', async () => { const result = await ipcRenderer.invoke('memory:remove', scope, keyFor(), entry.id); catalog.state = result.state; render(); }); row.append(text, remove); list.appendChild(row); } };
  const load = () => ipcRenderer.invoke('memory:load', workspace, session).then((value) => { catalog = value; render(); });
  for (const button of panel.querySelectorAll('[data-scope]')) button.addEventListener('click', () => { scope = button.dataset.scope; for (const item of panel.querySelectorAll('[data-scope]')) item.dataset.active = String(item === button); status.textContent = scope === 'system' ? '系统 > 项目 > 会话' : scope === 'project' ? `项目：${workspace}` : `会话：${session}`; render(); });
  panel.querySelector('[data-scope="system"]').dataset.active = 'true';
  panel.querySelector('.dsh-memory-close').addEventListener('click', () => closeFeaturePage(panel, style));
  panel.querySelector('.dsh-memory-add').addEventListener('click', async () => { const input = panel.querySelector('.dsh-memory-input'); if (!input.value.trim()) return; const result = await ipcRenderer.invoke('memory:add', scope, keyFor(), input.value); catalog.state = result.state; input.value = ''; render(); });
  panel.querySelector('.dsh-memory-clear').addEventListener('click', async () => { if (!window.confirm('清空当前记忆层？')) return; const result = await ipcRenderer.invoke('memory:clear', scope, keyFor()); catalog.state = result.state; render(); });
  panel.querySelector('.dsh-memory-export').addEventListener('click', async () => { const result = await ipcRenderer.invoke('memory:export', workspace, session); status.textContent = result?.filePath ? `已导出：${result.filePath}` : '已取消导出'; });
  load().catch((error) => { status.textContent = error.message; });
}

function openPluginManager() {
  let panel = document.querySelector('.dsh-plugin-manager');
  if (panel) {
    closeFeaturePage(panel, document.querySelector('style[data-dsh-plugin-page]'));
    return;
  }
  panel = document.createElement('section');
  panel.className = 'dsh-plugin-manager dsh-feature-page';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `
    <div class="dsh-plugin-manager-header">
      <strong>插件管理</strong>
      <button type="button" class="dsh-plugin-close" aria-label="Close plugin manager" title="Close">\u00d7</button>
    </div>
    <div class="dsh-plugin-toolbar">
      <button type="button" class="dsh-plugin-install">安装本地插件</button>
      <label class="dsh-plugin-filter-label">分类
        <select class="dsh-plugin-category-filter" aria-label="筛选插件分类">
          <option value="all">全部插件</option>
        </select>
      </label>
      <button type="button" class="dsh-plugin-restart" disabled>重启应用</button>
    </div>
    <p class="dsh-plugin-status" aria-live="polite">正在读取插件状态...</p>
    <div class="dsh-plugin-list"></div>
  `;
  const style = document.createElement('style');
  style.dataset.dshPluginPage = 'true';
  style.textContent = `
    .dsh-plugin-manager { overflow: auto; padding: 24px; color: #e9edf5; background: #1b2028; font: 13px/1.4 "Segoe UI", system-ui, sans-serif; }
    .dsh-plugin-manager-header, .dsh-plugin-toolbar { display: flex; align-items: center; gap: 8px; padding: 12px 14px; }
    .dsh-plugin-manager-header { border-bottom: 1px solid #303945; font-size: 15px; }
    .dsh-plugin-manager-header strong { flex: 1; }
    .dsh-plugin-close { width: 28px; height: 28px; color: #dbe1ea; background: transparent; border: 0; font-size: 20px; cursor: pointer; }
    .dsh-plugin-toolbar { border-bottom: 1px solid #303945; }
    .dsh-plugin-toolbar button, .dsh-plugin-action, .dsh-plugin-category-filter, .dsh-plugin-category-select { border: 1px solid #465160; border-radius: 5px; padding: 6px 10px; color: #e9edf5; background: #252c36; cursor: pointer; font: inherit; }
    .dsh-plugin-toolbar button:hover, .dsh-plugin-action:hover { background: #303a47; }
    .dsh-plugin-toolbar button:disabled { opacity: .45; cursor: default; }
    .dsh-plugin-filter-label { display: flex; align-items: center; gap: 6px; color: #b9c3d0; }
    .dsh-plugin-status { margin: 0; padding: 8px 14px; color: #9ca8b8; }
    .dsh-plugin-list { display: grid; gap: 8px; padding: 0 14px 14px; }
    .dsh-plugin-category-group { display: grid; gap: 8px; }
    .dsh-plugin-category-heading { display: flex; align-items: baseline; gap: 8px; margin: 10px 0 0; color: #dbe5f4; font-size: 13px; }
    .dsh-plugin-category-heading small { color: #8491a3; font-weight: 400; }
    .dsh-plugin-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; align-items: center; padding: 10px 12px; border: 1px solid #303945; border-radius: 6px; background: #202630; }
    .dsh-plugin-card[data-enabled="false"] { opacity: .72; }
    .dsh-plugin-name-row { display: flex; min-width: 0; align-items: center; gap: 8px; }
    .dsh-plugin-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .dsh-plugin-category-badge { flex: none; padding: 1px 6px; color: #a9c8ff; background: #28394f; border-radius: 999px; font-size: 11px; }
    .dsh-plugin-meta { grid-column: 1; color: #9ca8b8; font-size: 12px; overflow-wrap: anywhere; }
    .dsh-plugin-actions { grid-column: 2; grid-row: 1 / span 2; display: flex; align-items: center; gap: 6px; }
    .dsh-plugin-action[data-enabled="true"] { color: #a7d7ae; }
    .dsh-plugin-action[data-enabled="false"] { color: #f2c37e; }
    .dsh-plugin-remove { color: #f0a5ad; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);
  makeFeaturePage(panel);
  panel.querySelector('.dsh-plugin-close').addEventListener('click', () => closeFeaturePage(panel, style));
  const list = panel.querySelector('.dsh-plugin-list');
  const status = panel.querySelector('.dsh-plugin-status');
  const restart = panel.querySelector('.dsh-plugin-restart');
  const categoryFilter = panel.querySelector('.dsh-plugin-category-filter');
  let catalog;
  const setPending = (pending) => { restart.disabled = !pending; status.textContent = pending ? '更改将在重启后生效' : '插件状态已同步'; };
  const populateCategoryFilter = () => {
    const selected = categoryFilter.value;
    categoryFilter.replaceChildren(new Option('全部插件', 'all'));
    for (const category of catalog?.categories || []) categoryFilter.appendChild(new Option(`${category.label}（${category.count}）`, category.id));
    categoryFilter.value = [...categoryFilter.options].some((option) => option.value === selected) ? selected : 'all';
  };
  const render = (nextCatalog) => {
    catalog = nextCatalog;
    populateCategoryFilter();
    list.replaceChildren();
    const visibleEntries = (catalog?.entries || []).filter((entry) => categoryFilter.value === 'all' || entry.category === categoryFilter.value);
    if (!visibleEntries.length) {
      const empty = document.createElement('p');
      empty.className = 'dsh-plugin-status';
      empty.textContent = '这个分类还没有插件。';
      list.appendChild(empty);
      return;
    }
    for (const category of catalog?.categories || []) {
      const entries = visibleEntries.filter((entry) => entry.category === category.id);
      if (!entries.length) continue;
      const group = document.createElement('section');
      group.className = 'dsh-plugin-category-group';
      const heading = document.createElement('h2');
      heading.className = 'dsh-plugin-category-heading';
      heading.append(document.createTextNode(category.label));
      const count = document.createElement('small');
      count.textContent = `${entries.length} 个插件`;
      heading.appendChild(count);
      group.appendChild(heading);
      for (const entry of entries) {
      const card = document.createElement('article');
      card.className = 'dsh-plugin-card';
      card.dataset.enabled = String(entry.enabled !== false);
      const nameRow = document.createElement('div');
      nameRow.className = 'dsh-plugin-name-row';
      const name = document.createElement('div');
      name.className = 'dsh-plugin-name';
      name.textContent = entry.moduleName;
      const badge = document.createElement('span');
      badge.className = 'dsh-plugin-category-badge';
      badge.textContent = category.label;
      nameRow.append(name, badge);
      const meta = document.createElement('div');
      meta.className = 'dsh-plugin-meta';
      meta.textContent = `${entry.builtIn ? '内置' : '本地'}  ·  v${entry.version || 'unknown'}  ·  ${entry.phase || (entry.enabled === false ? '已关闭' : entry.builtIn ? '运行中' : '待重启')}`;
      const actions = document.createElement('div');
      actions.className = 'dsh-plugin-actions';
      const categorySelect = document.createElement('select');
      categorySelect.className = 'dsh-plugin-category-select';
      categorySelect.setAttribute('aria-label', `${entry.moduleName} 的分类`);
      for (const option of catalog?.categories || []) categorySelect.appendChild(new Option(option.label, option.id, false, option.id === entry.category));
      categorySelect.addEventListener('change', async () => {
        categorySelect.disabled = true;
        try {
          const updatedCatalog = await ipcRenderer.invoke('plugins:set-category', entry.id, categorySelect.value);
          render(updatedCatalog);
          status.textContent = '插件分类已保存';
        } catch (error) {
          status.textContent = error.message;
          categorySelect.value = entry.category;
        }
        categorySelect.disabled = false;
      });
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'dsh-plugin-action';
      toggle.dataset.enabled = String(entry.enabled !== false);
      toggle.textContent = entry.enabled === false ? '启用' : '关闭';
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          await ipcRenderer.invoke('plugins:toggle', entry.id, entry.enabled === false);
          entry.enabled = entry.enabled === false;
          card.dataset.enabled = String(entry.enabled);
          toggle.dataset.enabled = String(entry.enabled);
          toggle.textContent = entry.enabled ? '关闭' : '启用';
          setPending(true);
        } catch (error) { status.textContent = error.message; }
        toggle.disabled = false;
      });
      actions.append(categorySelect, toggle);
      if (!entry.builtIn) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'dsh-plugin-action dsh-plugin-remove';
        remove.textContent = '移除';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`移除 ${entry.moduleName}？`)) return;
          try { await ipcRenderer.invoke('plugins:remove', entry.id); setPending(true); card.remove(); } catch (error) { status.textContent = error.message; }
        });
        actions.appendChild(remove);
      }
      card.append(nameRow, meta, actions);
      group.appendChild(card);
      }
      list.appendChild(group);
    }
  };
  categoryFilter.addEventListener('change', () => render(catalog));
  ipcRenderer.invoke('plugins:load').then((catalog) => { render(catalog); setPending(Boolean(catalog?.pendingRestart)); }).catch((error) => { status.textContent = error.message; });
  panel.querySelector('.dsh-plugin-install').addEventListener('click', async () => {
    try {
      const result = await ipcRenderer.invoke('plugins:pick-install');
      if (result?.canceled) return;
      render(result.catalog);
      setPending(true);
    } catch (error) { status.textContent = error.message; }
  });
  restart.addEventListener('click', async () => {
    restart.disabled = true;
    status.textContent = '正在重启后台...';
    try { await ipcRenderer.invoke('plugins:restart'); closeFeaturePage(panel, style); } catch (error) { status.textContent = error.message; restart.disabled = false; }
  });
  ipcRenderer.once('plugins:rollback', (_event, message) => { status.textContent = message?.message || '插件已回滚'; });
}

function pinKey(kind, workspace, title) {
  const scope = String(workspace || '').trim();
  const value = String(title || '').trim();
  return `${kind}:${scope}::${value}`;
}

function installPinFeature(initialState) {
  const state = {
    workspaces: [...new Set(initialState?.workspaces || [])],
    sessions: [...new Set(initialState?.sessions || [])]
  };
  let scheduled = false;
  let persisting = Promise.resolve();

  const persist = () => {
    const snapshot = {
      workspaces: [...state.workspaces],
      sessions: [...state.sessions]
    };
    persisting = persisting.then(() => ipcRenderer.invoke('pins:save', snapshot)).catch(() => {});
  };

  const toggle = (kind, key) => {
    const list = state[kind];
    const index = list.indexOf(key);
    if (index === -1) list.push(key);
    else list.splice(index, 1);
    persist();
    schedule();
  };

  const isPinned = (kind, key) => state[kind].includes(key);
  const pinOrder = (kind, key) => {
    const index = state[kind].indexOf(key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const createPinButton = (kind, key) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dsh-pin-button';
    button.setAttribute('aria-label', 'Pin');
    button.title = 'Pin';
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle(kind, key);
    });
    return button;
  };

  const updateButton = (button, kind, key) => {
    const pinned = isPinned(kind, key);
    const row = button.closest('[role="treeitem"]');
    button.setAttribute('aria-pressed', String(pinned));
    button.setAttribute('aria-label', pinned ? '取消置顶' : '置顶');
    button.title = pinned ? '取消置顶' : '置顶';
    button.innerHTML = pinned
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.86 1.62a.75.75 0 0 1 .13 1.05L9.9 4h1.35c.77 0 1.21.88.75 1.49L9.68 8.56v2.69l.8.8a.75.75 0 1 1-1.06 1.06l-.8-.8H7.38l-.8.8a.75.75 0 1 1-1.06-1.06l.8-.8V8.56L4.01 5.49A.94.94 0 0 1 4.76 4H6.1L5.01 2.67a.75.75 0 0 1 1.16-.95L7.84 3.76h.32l1.68-2.04a.75.75 0 0 1 1.02-.1Z" fill="currentColor"/><path d="m7.44 12.1-1.9 2.63a.5.5 0 0 0 .81.59l1.65-2.28.72.99a.5.5 0 0 0 .81-.59L8.56 12.1H7.44Z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8.19 1.8a.75.75 0 0 0-1.06 0L5.61 3.32 3.97 1.68 2.49 3.16l1.64 1.64-1.52 1.52a.75.75 0 0 0 .53 1.28h2.22l1.1 1.1v3.17c0 .2.08.39.22.53l1.05 1.05a.75.75 0 1 0 1.06-1.06L7.74 11.23V8.7l1.1-1.1h2.22a.75.75 0 0 0 .53-1.28l-1.52-1.52 1.64-1.64-1.48-1.48-1.64 1.64L8.19 1.8Z" fill="currentColor"/></svg>';
    if (row) row.dataset.dshPinned = String(pinned);
  };

  const wrapperFor = (row) => row?.parentElement;
  const directGroups = (tree) => [...tree.children].filter((group) => group.querySelector('[role="treeitem"][aria-expanded]'));

  const decorate = () => {
    const tree = document.querySelector('[role="tree"]');
    if (!tree) return [];
    const groups = directGroups(tree);
    for (const group of groups) {
      const project = group.querySelector('[role="treeitem"][aria-expanded]');
      const workspaceName = project?.querySelector('[class*="projectText"], [class*="title"]')?.textContent?.trim() || project?.textContent?.trim() || '';
      if (project && workspaceName) {
        const key = pinKey('workspace', '', workspaceName);
        const actions = project.querySelector('[class*="rowActions"]');
        if (actions && !project.querySelector('.dsh-pin-button')) {
          const pin = createPinButton('workspaces', key);
          project.insertBefore(pin, actions);
        }
        const pin = project.querySelector('.dsh-pin-button');
        if (pin) updateButton(pin, 'workspaces', key);
      }
      for (const row of group.querySelectorAll('[role="treeitem"]')) {
        if (row === project || !row.matches('[draggable="true"]')) continue;
        const title = row.querySelector('[class*="title"]')?.textContent?.trim() || '';
        const menu = row.querySelector('button[aria-label*="的操作"], button[aria-label*="actions"]');
        if (!title || !menu) continue;
        const workspaceKey = workspaceName;
        const key = pinKey('session', workspaceKey, title);
        const actions = menu.closest('[class*="rowActions"]') || menu.parentElement?.parentElement;
        if (actions && !row.querySelector('.dsh-pin-button')) {
          const pin = createPinButton('sessions', key);
          row.insertBefore(pin, actions);
        }
        const pin = row.querySelector('.dsh-pin-button');
        if (pin) updateButton(pin, 'sessions', key);
      }
    }
    return groups;
  };

  const reorder = (groups) => {
    for (const group of groups) {
      const project = group.querySelector('[role="treeitem"][aria-expanded]');
      if (!project) continue;
      const projectWrapper = wrapperFor(project);
      const workspaceName = project.querySelector('[class*="projectText"], [class*="title"]')?.textContent?.trim() || project.textContent?.trim() || '';
      const workspaceKey = pinKey('workspace', '', workspaceName);
      const groupRows = [...group.children].map((child) => child.querySelector('[role="treeitem"]')).filter(Boolean);
      const sessionRows = groupRows.filter((row) => row !== project && row.matches('[draggable="true"]'));
      const rowOrder = (row) => {
        const title = row.querySelector('[class*="title"]')?.textContent?.trim() || '';
        return pinOrder('sessions', pinKey('session', workspaceName, title));
      };
      sessionRows.sort((left, right) => rowOrder(left) - rowOrder(right));
      if (projectWrapper && group.firstElementChild !== projectWrapper) {
        group.insertBefore(projectWrapper, group.firstElementChild);
      }
      let anchor = projectWrapper;
      for (const row of sessionRows) {
        const wrapper = wrapperFor(row);
        if (!wrapper || !anchor) continue;
        if (anchor.nextElementSibling !== wrapper) group.insertBefore(wrapper, anchor.nextElementSibling);
        anchor = wrapper;
      }
    }
    const tree = document.querySelector('[role="tree"]');
    if (tree) {
      const groupsWithProjects = directGroups(tree);
      groupsWithProjects.sort((left, right) => {
        const leftProject = left.querySelector('[role="treeitem"][aria-expanded]');
        const rightProject = right.querySelector('[role="treeitem"][aria-expanded]');
        const leftName = leftProject?.textContent?.trim() || '';
        const rightName = rightProject?.textContent?.trim() || '';
        return pinOrder('workspaces', pinKey('workspace', '', leftName)) - pinOrder('workspaces', pinKey('workspace', '', rightName));
      });
      let previousGroup;
      for (const group of groupsWithProjects) {
        if (previousGroup?.nextElementSibling !== group) {
          if (previousGroup) tree.insertBefore(group, previousGroup.nextElementSibling);
          else if (tree.firstElementChild !== group) tree.insertBefore(group, tree.firstElementChild);
        }
        previousGroup = group;
      }
    }
  };

  const run = () => {
    scheduled = false;
    const groups = decorate();
    reorder(groups);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(run, 80);
  };

  const style = document.createElement('style');
  style.textContent = `
    .dsh-pin-button {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      flex: none;
      padding: 0;
      border: 0;
      color: var(--dsw-alias-label-tertiary, #89919e);
      background: transparent;
      border-radius: 6px;
      margin-left: 2px;
      opacity: 0;
      pointer-events: none;
      transition: color 140ms ease, background 140ms ease, opacity 140ms ease, transform 140ms ease;
    }
    .dsh-pin-button svg { width: 15px; height: 15px; }
    [role="treeitem"]:hover > .dsh-pin-button,
    [role="treeitem"] > .dsh-pin-button[aria-pressed="true"] {
      opacity: 1;
      pointer-events: auto;
    }
    .dsh-pin-button:hover,
    .dsh-pin-button:focus-visible,
    .dsh-pin-button[aria-pressed="true"] {
      color: #a970ff;
      background: color-mix(in srgb, #a970ff 14%, transparent);
    }
    .dsh-pin-button:hover { transform: translateY(-1px); }
    [role="treeitem"][data-dsh-pinned="true"] {
      box-shadow: inset 2px 0 0 #a970ff;
      background: color-mix(in srgb, #a970ff 8%, transparent);
    }
    .dsh-pin-button:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 1px;
    }
  `;
  document.head.appendChild(style);
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
}

function installDesktopEnhancements() {
  installWindowChrome();
  ipcRenderer.invoke('pins:load').then(installPinFeature, () => installPinFeature({ workspaces: [], sessions: [] }));
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', installDesktopEnhancements, { once: true });
} else {
  installDesktopEnhancements();
}
