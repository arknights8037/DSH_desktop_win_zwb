const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { BackendSupervisor } = require('./backend');
const { createProjectGitService } = require('./project-git-service.cjs');

const execFileAsync = promisify(execFile);

let mainWindow;
let backend;
let projectGit;

function registeredWorkspacePaths() {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'home', 'storages', 'workspace.json'), 'utf8'));
    return Object.values(registry?.tables?.workspaces || {}).flatMap((workspace) => typeof workspace?.path === 'string' ? [workspace.path] : []);
  } catch {
    return [];
  }
}

function loadSimpleGit() {
  const searchPaths = app.isPackaged
    ? [path.join(process.resourcesPath, 'backend', 'node_modules')]
    : [path.join(__dirname, '..', 'node_modules'), path.join(__dirname, '..', 'backend-dist', 'node_modules')];
  const modulePath = require.resolve('simple-git', { paths: searchPaths });
  return require(modulePath).simpleGit;
}

function projectGitService() {
  projectGit ??= createProjectGitService({ gitFactory: loadSimpleGit(), allowedWorkspacePaths: registeredWorkspacePaths });
  return projectGit;
}

function appendWindowLog(message) {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'window.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Diagnostics must never prevent the window from starting.
  }
}

function sanitizePinState(value) {
  const list = (input) => Array.isArray(input)
    ? [...new Set(input.filter((item) => typeof item === 'string' && item.length > 0 && item.length <= 512))]
    : [];
  return {
    workspaces: list(value?.workspaces),
    sessions: list(value?.sessions)
  };
}

function pinsPath() {
  return path.join(app.getPath('userData'), 'desktop-pins.json');
}

function pluginStatePath() {
  return path.join(app.getPath('userData'), 'home', 'desktop-plugins.json');
}

function memoryPath() {
  return path.join(app.getPath('userData'), 'home', 'desktop-memory.json');
}

function integrationsPath() {
  return path.join(app.getPath('userData'), 'home', 'desktop-integrations.json');
}

function skillImportRoot() {
  return path.join(app.getPath('userData'), 'home', 'skills');
}

const PLUGIN_CATEGORIES = Object.freeze([
  { id: 'agent', label: '智能体与自动化' },
  { id: 'development', label: '开发与文件' },
  { id: 'data', label: '数据与会话' },
  { id: 'network', label: '网络与信息' },
  { id: 'interface', label: '界面与系统' },
  { id: 'other', label: '其他' }
]);

const PLUGIN_CATEGORY_IDS = new Set(PLUGIN_CATEGORIES.map((category) => category.id));

function normalizePluginCategory(value) {
  return typeof value === 'string' && PLUGIN_CATEGORY_IDS.has(value) ? value : undefined;
}

function inferPluginCategory(id, moduleName, manifest = {}) {
  const searchable = [id, moduleName, manifest.description, ...(Array.isArray(manifest.keywords) ? manifest.keywords : [])]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase();
  if (/(subagent|workflow|agent|plan|goal|compact|todo|persona|instruction|automation|\bllm\b|artificial intelligence|model)/.test(searchable)) return 'agent';
  if (/(bash|pwsh|shell|terminal|tool-fs|filesystem|file|editor|code|git|skill)/.test(searchable)) return 'development';
  if (/(storage|session|workspace|memory|database|sqlite|cache|projection|data)/.test(searchable)) return 'data';
  if (/(web|browser|search|fetch|http|network|reference)/.test(searchable)) return 'network';
  if (/(ui-|client|renderer|layout|theme|locale|desktop|attachment|settings|sidebar|dialog|window)/.test(searchable)) return 'interface';
  return 'other';
}

function resolveMemoryKeys(workspace, session) {
  let projectKey = String(workspace || 'default').trim() || 'default';
  let sessionKey = String(session || 'default').trim() || 'default';
  const home = path.join(app.getPath('userData'), 'home');
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(home, 'storages', 'workspace.json'), 'utf8'));
    const rows = Object.values(registry?.tables?.workspaces || {});
    const match = rows.find((row) => row.title === workspace || row.path === workspace);
    if (match?.path) {
      try { projectKey = fs.realpathSync(match.path); } catch { projectKey = match.path; }
    }
  } catch {}
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(home, 'storages', 'session_projcache.json'), 'utf8'));
    const rows = Object.entries(cache?.tables?.sessions || {});
    const match = rows.find(([, row]) => {
      const title = row?.rows?.title?.val;
      return typeof title === 'string' && (title === session || String(session || '').startsWith(title)) && (!row?.identity?.cwd || row.identity.cwd === projectKey);
    });
    if (match?.[0]) sessionKey = match[0];
  } catch {}
  return { projectKey, sessionKey };
}

function sanitizeMemoryEntry(entry) {
  if (!entry || typeof entry.text !== 'string') return null;
  const text = entry.text.trim().slice(0, 4000);
  if (!text) return null;
  return {
    id: typeof entry.id === 'string' ? entry.id.slice(0, 120) : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now()
  };
}

function sanitizeMemoryState(value) {
  const list = (items) => (Array.isArray(items) ? items : []).map(sanitizeMemoryEntry).filter(Boolean);
  const maps = (input) => Object.fromEntries(Object.entries(input && typeof input === 'object' ? input : {}).map(([key, entries]) => [key.slice(0, 512), list(entries)]));
  return { system: list(value?.system), projects: maps(value?.projects), sessions: maps(value?.sessions) };
}

function readMemoryState() {
  try { return sanitizeMemoryState(JSON.parse(fs.readFileSync(memoryPath(), 'utf8'))); } catch { return { system: [], projects: {}, sessions: {} }; }
}

function saveMemoryState(value) {
  const state = sanitizeMemoryState(value);
  fs.mkdirSync(path.dirname(memoryPath()), { recursive: true });
  fs.writeFileSync(memoryPath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
}

function normalizeAbsoluteDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return undefined;
  const candidate = path.normalize(value.trim());
  if (!candidate || candidate.length > 4096) return undefined;
  try { return fs.statSync(candidate).isDirectory() ? fs.realpathSync(candidate) : undefined; } catch { return undefined; }
}

function sanitizeMcpServer(value, index = 0) {
  if (!value || typeof value !== 'object') return undefined;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const transport = value.transport === 'streamable-http' ? 'streamable-http' : value.transport === 'stdio' ? 'stdio' : undefined;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name) || !transport) return undefined;
  const id = typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.id)
    ? value.id : `mcp-${index}-${name}`;
  if (transport === 'stdio') {
    const command = typeof value.command === 'string' ? value.command.trim() : '';
    if (!command || command.length > 1024) return undefined;
    const args = Array.isArray(value.args) ? value.args.filter((item) => typeof item === 'string').map((item) => item.slice(0, 4096)).slice(0, 64) : [];
    const cwd = value.cwd === '' || value.cwd === undefined ? undefined : normalizeAbsoluteDirectory(value.cwd);
    return { id, name, enabled: value.enabled !== false, transport, command, args, ...(cwd ? { cwd } : {}) };
  }
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
  } catch { return undefined; }
  return { id, name, enabled: value.enabled !== false, transport, url };
}

function sanitizeIntegrationsState(value) {
  const skillDirs = [...new Set((Array.isArray(value?.skillDirs) ? value.skillDirs : [])
    .map(normalizeAbsoluteDirectory).filter(Boolean))].slice(0, 32);
  const seenNames = new Set();
  const mcpServers = [];
  for (const [index, item] of (Array.isArray(value?.mcpServers) ? value.mcpServers : []).entries()) {
    const server = sanitizeMcpServer(item, index);
    if (!server || seenNames.has(server.name)) continue;
    seenNames.add(server.name);
    mcpServers.push(server);
  }
  const importRoot = path.resolve(skillImportRoot());
  const importedSkills = (Array.isArray(value?.importedSkills) ? value.importedSkills : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const id = typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(item.id) ? item.id : undefined;
    const name = typeof item.name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.name) ? item.name : undefined;
    const source = typeof item.source === 'string' ? item.source.trim().slice(0, 4096) : '';
    const location = typeof item.location === 'string' ? path.resolve(item.location) : '';
    const kind = item.kind === 'file' ? 'file' : item.kind === 'directory' ? 'directory' : undefined;
    if (!id || !name || !source || !kind || path.dirname(location) !== importRoot) return [];
    return [{ id, name, source, location, kind, importedAt: Number.isFinite(item.importedAt) ? item.importedAt : Date.now() }];
  });
  return { skillDirs, importedSkills, mcpServers };
}

function readIntegrationsState() {
  try { return sanitizeIntegrationsState(JSON.parse(fs.readFileSync(integrationsPath(), 'utf8'))); }
  catch { return { skillDirs: [], importedSkills: [], mcpServers: [] }; }
}

function saveIntegrationsState(value) {
  const state = sanitizeIntegrationsState(value);
  fs.mkdirSync(path.dirname(integrationsPath()), { recursive: true });
  fs.writeFileSync(integrationsPath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  backend?.applyIntegrationsState();
  return state;
}

function parseSkillName(source) {
  const frontmatter = source.match(/^---[\t ]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const rawName = frontmatter?.match(/^name:[\t ]*(.+?)[\t ]*$/m)?.[1]?.trim();
  const name = rawName?.match(/^['"](.*)['"]$/)?.[1] ?? rawName;
  return typeof name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ? name : undefined;
}

function readSkillName(filePath) {
  try { return parseSkillName(fs.readFileSync(filePath, 'utf8').slice(0, 262144)); }
  catch { return undefined; }
}

function normalizeSkillAddress(value) {
  let address = typeof value === 'string' ? value.trim() : '';
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(address)) address = `https://github.com/${address}`;
  if (address.startsWith('git+https://')) address = address.slice(4);
  let parsed;
  try { parsed = new URL(address); } catch { throw new Error('请输入有效的 HTTPS Skill 地址'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Skill 地址必须是不含凭据的 HTTPS 地址');
  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (parsed.hostname.toLocaleLowerCase() === 'github.com' && segments.length >= 2) {
    const [owner, rawRepository, mode, ref, ...subpath] = segments;
    const repository = rawRepository.replace(/\.git$/i, '');
    if (mode === 'tree' || mode === 'blob') {
      if (!ref || subpath.length === 0) throw new Error('GitHub 子目录地址缺少分支或路径');
      if (ref.startsWith('-') || ref.length > 255) throw new Error('GitHub 分支名称无效');
      return {
        kind: 'git',
        cloneUrl: `https://github.com/${owner}/${repository}.git`,
        ref,
        subpath: mode === 'blob' ? subpath.slice(0, -1) : subpath,
        source: parsed.href,
      };
    }
    if (segments.length === 2) return { kind: 'git', cloneUrl: `https://github.com/${owner}/${repository}.git`, source: parsed.href };
  }
  if (/\.md$/i.test(parsed.pathname)) return { kind: 'markdown', url: parsed.href, source: parsed.href };
  return { kind: 'git', cloneUrl: parsed.href, source: parsed.href };
}

function skillEntriesAt(root) {
  const bundleFile = path.join(root, 'SKILL.md');
  const bundleName = readSkillName(bundleFile);
  if (bundleName) return [{ name: bundleName, kind: 'directory', sourcePath: root }];
  const entries = [];
  let children;
  try { children = fs.readdirSync(root, { withFileTypes: true }); } catch { return entries; }
  for (const child of children) {
    const sourcePath = path.join(root, child.name);
    if (child.isDirectory()) {
      const name = readSkillName(path.join(sourcePath, 'SKILL.md'));
      if (name) entries.push({ name, kind: 'directory', sourcePath });
    } else if (child.isFile() && /\.md$/i.test(child.name) && child.name.toLocaleLowerCase() !== 'skill.md') {
      const name = readSkillName(sourcePath);
      if (name) entries.push({ name, kind: 'file', sourcePath });
    }
  }
  return entries;
}

function discoverImportedSkillEntries(root) {
  const candidates = [root, path.join(root, 'skills'), path.join(root, '.dsh', 'skills'), path.join(root, '.agents', 'skills')];
  const entries = [];
  const seenSources = new Set();
  for (const candidate of candidates) {
    for (const entry of skillEntriesAt(candidate)) {
      const sourcePath = path.resolve(entry.sourcePath);
      if (seenSources.has(sourcePath)) continue;
      seenSources.add(sourcePath);
      entries.push(entry);
    }
  }
  return entries;
}

async function downloadMarkdownSkill(url, destination) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Skill 下载失败（HTTP ${response.status}）`);
  if (new URL(response.url).protocol !== 'https:') throw new Error('Skill 下载重定向到了非 HTTPS 地址');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 1024 * 1024) throw new Error('Skill Markdown 超过 1 MiB');
  const source = await response.text();
  if (Buffer.byteLength(source, 'utf8') > 1024 * 1024) throw new Error('Skill Markdown 超过 1 MiB');
  const name = parseSkillName(source);
  if (!name) throw new Error('地址未提供有效的 Skill Markdown（需要 kebab-case name frontmatter）');
  fs.writeFileSync(destination, source, 'utf8');
  return [{ name, kind: 'file', sourcePath: destination }];
}

function removeImportPath(location) {
  fs.rmSync(location, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
}

function cleanTemporaryImportRoot(location) {
  try { removeImportPath(location); }
  catch (error) {
    appendWindowLog(`skill-import-cleanup-retry path=${location} message=${error?.message || error}`);
    const retry = setTimeout(() => {
      try { removeImportPath(location); }
      catch (reason) { appendWindowLog(`skill-import-cleanup-abandoned path=${location} message=${reason?.message || reason}`); }
    }, 1500);
    retry.unref?.();
  }
}

async function importSkillsFromAddress(address) {
  const normalized = normalizeSkillAddress(address);
  const temporaryRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'dsh-skill-import-'));
  const checkout = path.join(temporaryRoot, 'checkout');
  const importRoot = skillImportRoot();
  const created = [];
  try {
    let entries;
    if (normalized.kind === 'markdown') {
      fs.mkdirSync(checkout, { recursive: true });
      entries = await downloadMarkdownSkill(normalized.url, path.join(checkout, 'skill.md'));
    } else {
      const args = ['clone', '--depth', '1', '--filter=blob:none'];
      if (normalized.ref) args.push('--branch', normalized.ref);
      args.push('--', normalized.cloneUrl, checkout);
      try {
        await execFileAsync('git', args, { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 });
      } catch (error) {
        if (error?.code === 'ENOENT') throw new Error('导入 Git Skill 需要先安装 Git');
        throw new Error(`无法克隆 Skill 地址：${String(error?.stderr || error?.message || error).trim().slice(0, 500)}`);
      }
      const selected = normalized.subpath?.length ? path.resolve(checkout, ...normalized.subpath) : checkout;
      if (selected !== checkout && !selected.startsWith(`${checkout}${path.sep}`)) throw new Error('Skill 子目录地址越过了仓库根目录');
      let selectedReal;
      try { selectedReal = fs.realpathSync(selected); } catch { throw new Error('Skill 子目录在仓库中不存在'); }
      const checkoutReal = fs.realpathSync(checkout);
      if (selectedReal !== checkoutReal && !selectedReal.startsWith(`${checkoutReal}${path.sep}`)) throw new Error('Skill 子目录指向仓库外部');
      if (!fs.statSync(selectedReal).isDirectory()) throw new Error('Skill 地址必须指向目录或 Markdown 文件');
      entries = discoverImportedSkillEntries(selectedReal);
    }
    if (!entries.length) throw new Error('地址中未找到 DSH 支持的 SKILL.md 或平铺 Markdown Skill');
    const names = new Set();
    for (const entry of entries) {
      if (names.has(entry.name)) throw new Error(`地址中存在重复 Skill：${entry.name}`);
      names.add(entry.name);
      const location = path.join(importRoot, entry.kind === 'file' ? `${entry.name}.md` : entry.name);
      if (fs.existsSync(location)) throw new Error(`Skill 已存在：${entry.name}`);
      entry.location = location;
    }
    fs.mkdirSync(importRoot, { recursive: true });
    for (const entry of entries) {
      created.push(entry.location);
      if (entry.kind === 'file') fs.copyFileSync(entry.sourcePath, entry.location);
      else fs.cpSync(entry.sourcePath, entry.location, {
        recursive: true,
        filter: (candidate) => path.basename(candidate) !== '.git' && !fs.lstatSync(candidate).isSymbolicLink(),
      });
    }
    const importedAt = Date.now();
    return entries.map((entry, index) => ({
      id: `skill-${importedAt}-${index}-${Math.random().toString(16).slice(2, 10)}`,
      name: entry.name,
      source: normalized.source,
      location: entry.location,
      kind: entry.kind,
      importedAt,
    }));
  } catch (error) {
    for (const location of created) {
      try { removeImportPath(location); }
      catch (reason) { appendWindowLog(`skill-import-rollback-error path=${location} message=${reason?.message || reason}`); }
    }
    throw error;
  } finally {
    cleanTemporaryImportRoot(temporaryRoot);
  }
}

function memoryContext(state, workspace, session) {
  const projectKey = String(workspace || 'default').trim() || 'default';
  const suppliedSession = String(session || 'default').trim() || 'default';
  const sessionKey = suppliedSession.startsWith(`${projectKey}::`)
    ? suppliedSession
    : `${projectKey}::${suppliedSession}`;
  const merged = [];
  const seen = new Set();
  for (const entry of [...state.system, ...(state.projects[projectKey] || []), ...(state.sessions[sessionKey] || [])]) {
    const key = entry.text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return { projectKey, sessionKey, merged };
}

function sanitizePluginState(value) {
  const plugins = Array.isArray(value?.plugins) ? value.plugins : [];
  return {
    plugins: plugins.filter((plugin) => plugin && typeof plugin.id === 'string' && typeof plugin.moduleName === 'string')
      .map((plugin) => ({
        id: plugin.id.slice(0, 160),
        moduleName: plugin.moduleName.slice(0, 512),
        version: typeof plugin.version === 'string' ? plugin.version.slice(0, 80) : 'unknown',
        enabled: plugin.enabled !== false,
        builtIn: plugin.builtIn === true,
        installedPath: typeof plugin.installedPath === 'string' ? plugin.installedPath : undefined,
        backupPath: typeof plugin.backupPath === 'string' ? plugin.backupPath : undefined,
        previousVersion: typeof plugin.previousVersion === 'string' ? plugin.previousVersion : undefined,
        category: normalizePluginCategory(plugin.category)
      })),
    lastChange: value?.lastChange && typeof value.lastChange.id === 'string' ? {
      id: value.lastChange.id,
      type: value.lastChange.type,
      backupPath: typeof value.lastChange.backupPath === 'string' ? value.lastChange.backupPath : undefined,
      previousEnabled: typeof value.lastChange.previousEnabled === 'boolean' ? value.lastChange.previousEnabled : undefined
    } : undefined
  };
}

function readPluginState() {
  try {
    return sanitizePluginState(JSON.parse(fs.readFileSync(pluginStatePath(), 'utf8')));
  } catch {
    return { plugins: [] };
  }
}

function savePluginState(value) {
  const state = sanitizePluginState(value);
  fs.mkdirSync(path.dirname(pluginStatePath()), { recursive: true });
  fs.writeFileSync(pluginStatePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
}

function pluginPackageRoot() {
  return path.join(app.getPath('userData'), 'home', 'node_modules');
}

function packageNamePath(name) {
  const parts = name.startsWith('@') ? name.split('/') : [name];
  if (parts.length < 1 || parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) throw new Error('插件包名无效');
  return path.join(pluginPackageRoot(), ...parts);
}

function readPackageManifest(packageDir) {
  const manifestPath = path.join(packageDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.name !== 'string' || !manifest.name) throw new Error('目录中的 package.json 缺少 name');
  return manifest;
}

function builtinPluginRows() {
  const root = path.join(process.resourcesPath, 'backend', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml');
  const fallback = path.join(__dirname, '..', 'upstream-dsh', 'packages', 'bundle', 'web-app', 'cordis.patch.yml');
  let source = '';
  try { source = fs.readFileSync(app.isPackaged ? root : fallback, 'utf8'); } catch { return []; }
  const rows = [];
  let current;
  for (const line of source.split(/\r?\n/)) {
    const id = line.match(/^\s*- id:\s*([\w-]+)/)?.[1];
    const name = line.match(/^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/)?.[1];
    if (id) current = { id, moduleName: null };
    if (name && current) {
      current.moduleName = name;
      rows.push(current);
      current = undefined;
    }
  }
  return rows.filter((row) => row.moduleName);
}

function packageVersion(moduleName) {
  const roots = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'backend', 'node_modules'),
        path.join(process.resourcesPath, 'backend', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules')
      ]
    : [
        path.join(__dirname, '..', 'backend-dist', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
        path.join(__dirname, '..', 'backend-dist', 'node_modules'),
        path.join(__dirname, '..', 'node_modules')
      ];
  for (const root of roots) {
    try {
      const packagePath = path.join(root, ...moduleName.split('/'), 'package.json');
      return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version || 'unknown';
    } catch {}
  }
  return 'unknown';
}

function pluginCatalog() {
  const state = readPluginState();
  const overrides = new Map(state.plugins.map((plugin) => [plugin.id, plugin]));
  const entries = builtinPluginRows().map((row) => {
    const override = overrides.get(row.id);
    return {
      ...row,
      version: packageVersion(row.moduleName),
      enabled: override ? override.enabled !== false : true,
      builtIn: true,
      phase: override?.phase || null,
      category: override?.category || inferPluginCategory(row.id, row.moduleName)
    };
  });
  for (const plugin of state.plugins) {
    if (plugin.builtIn || entries.some((entry) => entry.id === plugin.id)) continue;
    let version = plugin.version || 'unknown';
    try { version = JSON.parse(fs.readFileSync(path.join(plugin.installedPath, 'package.json'), 'utf8')).version || version; } catch {}
    entries.push({ ...plugin, version, phase: null, category: plugin.category || inferPluginCategory(plugin.id, plugin.moduleName) });
  }
  const categorizedEntries = entries.sort((left, right) => {
    const categoryOrder = PLUGIN_CATEGORIES.findIndex((category) => category.id === left.category) - PLUGIN_CATEGORIES.findIndex((category) => category.id === right.category);
    return categoryOrder || left.moduleName.localeCompare(right.moduleName, 'zh-CN');
  });
  return {
    entries: categorizedEntries,
    categories: PLUGIN_CATEGORIES.map((category) => ({ ...category, count: categorizedEntries.filter((entry) => entry.category === category.id).length })),
    pendingRestart: Boolean(state.lastChange),
    state
  };
}

function applyPluginChange(state) {
  const next = savePluginState(state);
  backend?.applyPluginState();
  return next;
}

function rollbackLastPluginChange() {
  const state = readPluginState();
  const change = state.lastChange;
  if (!change) return false;
  const plugin = state.plugins.find((entry) => entry.id === change.id);
  try {
    if (change.type === 'toggle' && plugin && typeof change.previousEnabled === 'boolean') {
      plugin.enabled = change.previousEnabled;
    }
    if (change.type === 'install' && plugin?.installedPath) {
      fs.rmSync(plugin.installedPath, { recursive: true, force: true });
      if (change.backupPath && fs.existsSync(change.backupPath)) {
        fs.renameSync(change.backupPath, plugin.installedPath);
        plugin.version = plugin.previousVersion || plugin.version;
        plugin.backupPath = undefined;
      }
    }
    if (change.type === 'install' && !change.backupPath) state.plugins = state.plugins.filter((entry) => entry.id !== change.id);
    state.lastChange = undefined;
    applyPluginChange(state);
    return true;
  } catch (error) {
    appendWindowLog(`plugin-rollback-error ${error.stack || error.message}`);
    return false;
  }
}

ipcMain.handle('pins:load', () => {
  try {
    return sanitizePinState(JSON.parse(fs.readFileSync(pinsPath(), 'utf8')));
  } catch {
    return { workspaces: [], sessions: [] };
  }
});

ipcMain.handle('pins:save', (_event, value) => {
  const state = sanitizePinState(value);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(pinsPath(), `${JSON.stringify(state)}\n`, 'utf8');
  return state;
});

ipcMain.handle('plugins:load', () => pluginCatalog());

ipcMain.handle('plugins:toggle', (_event, id, enabled) => {
  const state = readPluginState();
  const entry = pluginCatalog().entries.find((item) => item.id === id);
  if (!entry) throw new Error('插件不存在');
  const existing = state.plugins.find((item) => item.id === id);
  const previousEnabled = existing ? existing.enabled !== false : entry.enabled !== false;
  if (existing) existing.enabled = enabled !== false;
  else state.plugins.push({ id, moduleName: entry.moduleName, version: entry.version, enabled: enabled !== false, builtIn: entry.builtIn === true });
  state.lastChange = { id, type: 'toggle', previousEnabled };
  return { ...applyPluginChange(state), pendingRestart: true };
});

ipcMain.handle('plugins:set-category', (_event, id, category) => {
  const normalizedCategory = normalizePluginCategory(category);
  if (!normalizedCategory) throw new Error('插件分类无效');
  const state = readPluginState();
  const entry = pluginCatalog().entries.find((item) => item.id === id);
  if (!entry) throw new Error('插件不存在');
  const existing = state.plugins.find((item) => item.id === id);
  if (existing) existing.category = normalizedCategory;
  else state.plugins.push({
    id,
    moduleName: entry.moduleName,
    version: entry.version,
    enabled: entry.enabled !== false,
    builtIn: entry.builtIn === true,
    category: normalizedCategory
  });
  savePluginState(state);
  return pluginCatalog();
});

ipcMain.handle('plugins:pick-install', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择插件目录',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const source = fs.realpathSync(result.filePaths[0]);
  const manifest = readPackageManifest(source);
  const destination = packageNamePath(manifest.name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const state = readPluginState();
  const id = `desktop-plugin-${manifest.name.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
  const previous = state.plugins.find((plugin) => plugin.id === id);
  const backupPath = fs.existsSync(destination) ? `${destination}.backup-${Date.now()}` : undefined;
  if (backupPath) fs.renameSync(destination, backupPath);
  try {
    fs.cpSync(source, destination, { recursive: true, force: true });
    state.plugins = state.plugins.filter((plugin) => plugin.id !== id);
    state.plugins.push({ id, moduleName: manifest.name, version: manifest.version || 'unknown', enabled: true, builtIn: false, installedPath: destination, backupPath, previousVersion: previous?.version, category: previous?.category || inferPluginCategory(id, manifest.name, manifest) });
    state.lastChange = { id, type: 'install', backupPath };
    applyPluginChange(state);
    return { canceled: false, pendingRestart: true, catalog: pluginCatalog() };
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    if (backupPath) fs.renameSync(backupPath, destination);
    throw error;
  }
});

ipcMain.handle('plugins:remove', (_event, id) => {
  const state = readPluginState();
  const index = state.plugins.findIndex((plugin) => plugin.id === id && !plugin.builtIn);
  if (index < 0) throw new Error('只能移除已安装的桌面插件');
  const [plugin] = state.plugins.splice(index, 1);
  if (plugin.installedPath) fs.rmSync(plugin.installedPath, { recursive: true, force: true });
  state.lastChange = { id, type: 'remove' };
  return { ...applyPluginChange(state), pendingRestart: true };
});

ipcMain.handle('plugins:restart', async () => {
  if (!backend) throw new Error('后台尚未启动');
  await backend.restart();
  return { pendingRestart: false };
});

ipcMain.handle('memory:load', (_event, workspace, session) => {
  const state = readMemoryState();
  const keys = resolveMemoryKeys(workspace, session);
  return { state, ...keys, merged: memoryContext(state, keys.projectKey, keys.sessionKey).merged };
});

ipcMain.handle('memory:add', (_event, scope, key, text) => {
  if (!['system', 'project', 'session'].includes(scope)) throw new Error('记忆层级无效');
  const entry = sanitizeMemoryEntry({ text });
  if (!entry) throw new Error('记忆内容不能为空');
  const state = readMemoryState();
  if (scope === 'system') state.system.push(entry);
  else {
    const map = scope === 'project' ? state.projects : state.sessions;
    const bucket = String(key || 'default').slice(0, 512);
    map[bucket] = [...(map[bucket] || []), entry];
  }
  saveMemoryState(state);
  return { state };
});

ipcMain.handle('memory:remove', (_event, scope, key, id) => {
  const state = readMemoryState();
  if (scope === 'system') state.system = state.system.filter((entry) => entry.id !== id);
  else {
    const map = scope === 'project' ? state.projects : state.sessions;
    if (map[key]) map[key] = map[key].filter((entry) => entry.id !== id);
  }
  saveMemoryState(state);
  return { state };
});

ipcMain.handle('memory:clear', (_event, scope, key) => {
  const state = readMemoryState();
  if (scope === 'system') state.system = [];
  else if (scope === 'project') delete state.projects[key];
  else delete state.sessions[key];
  saveMemoryState(state);
  return { state };
});

ipcMain.handle('memory:export', async (_event, workspace, session) => {
  const state = readMemoryState();
  const result = await dialog.showSaveDialog({ title: '导出记忆', defaultPath: 'deepseek-harness-memory.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  const keys = resolveMemoryKeys(workspace, session);
  fs.writeFileSync(result.filePath, `${JSON.stringify({ ...keys, merged: memoryContext(state, keys.projectKey, keys.sessionKey).merged, state }, null, 2)}\n`, 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('integrations:load', () => readIntegrationsState());

ipcMain.handle('integrations:pick-skill-directory', async () => {
  const result = await dialog.showOpenDialog({ title: '选择技能目录', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const directory = normalizeAbsoluteDirectory(result.filePaths[0]);
  if (!directory) throw new Error('技能目录不可用');
  return { canceled: false, directory };
});

ipcMain.handle('integrations:import-skill', async (_event, address) => {
  const imported = await importSkillsFromAddress(address);
  const state = readIntegrationsState();
  try {
    return saveIntegrationsState({ ...state, importedSkills: [...state.importedSkills, ...imported] });
  } catch (error) {
    for (const skill of imported) {
      try { removeImportPath(skill.location); }
      catch (reason) { appendWindowLog(`skill-import-save-rollback-error path=${skill.location} message=${reason?.message || reason}`); }
    }
    throw error;
  }
});

ipcMain.handle('integrations:remove-imported-skill', (_event, id) => {
  const state = readIntegrationsState();
  const skill = state.importedSkills.find((item) => item.id === id);
  if (!skill) throw new Error('导入的 Skill 不存在');
  const importRoot = path.resolve(skillImportRoot());
  const location = path.resolve(skill.location);
  if (path.dirname(location) !== importRoot) throw new Error('拒绝移除非桌面导入的 Skill');
  removeImportPath(location);
  return saveIntegrationsState({ ...state, importedSkills: state.importedSkills.filter((item) => item.id !== id) });
});

ipcMain.handle('integrations:save', (_event, value) => saveIntegrationsState(value));

ipcMain.handle('integrations:restart', async () => {
  if (!backend) throw new Error('后台尚未启动');
  await backend.restart();
  return { restarted: true };
});

ipcMain.handle('project-git:inspect', (_event, workspacePath) => projectGitService().inspect(workspacePath));

ipcMain.handle('project-git:execute', (_event, request) => projectGitService().execute(request));
ipcMain.handle('project-git:read', (_event, request) => projectGitService().read(request));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#111318',
    frame: false,
    autoHideMenuBar: true,
    title: 'DeepSeek Harness Desktop',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'window-preload.js')
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    appendWindowLog(`preload-error path=${preloadPath} message=${error?.stack || error?.message || error}`);
  });
  ipcMain.on('window:preload-ready', () => appendWindowLog('preload-ready'));

  const publishWindowState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:state', { maximized: mainWindow.isMaximized() });
    }
  };
  mainWindow.on('maximize', publishWindowState);
  mainWindow.on('unmaximize', publishWindowState);
  mainWindow.webContents.on('did-finish-load', publishWindowState);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://127.0.0.1:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

function getWindowForEvent(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window && !window.isDestroyed() ? window : undefined;
}

ipcMain.handle('window:minimize', (event) => {
  getWindowForEvent(event)?.minimize();
});

ipcMain.handle('window:toggle-maximize', (event) => {
  const window = getWindowForEvent(event);
  if (!window) return false;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
  return window.isMaximized();
});

ipcMain.handle('window:close', (event) => {
  getWindowForEvent(event)?.close();
});

async function start() {
  app.setAppUserModelId('ai.deepseek.harness.desktop');
  createWindow();

  backend = new BackendSupervisor({
    homeDir: path.join(app.getPath('userData'), 'home'),
    logDir: path.join(app.getPath('userData'), 'logs'),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged
  });

  backend.on('status', (status) => {
    if (status.type === 'url' && mainWindow && !mainWindow.isDestroyed()) {
      const pluginState = readPluginState();
      if (pluginState.lastChange) {
        pluginState.lastChange = undefined;
        savePluginState(pluginState);
      }
      mainWindow.loadURL(status.url).catch((error) => {
        dialog.showErrorBox('DeepSeek Harness', `无法加载本地界面：${error.message}`);
      });
    }
  });

  backend.on('fatal', (error) => {
    if (readPluginState().lastChange && rollbackLastPluginChange()) {
      appendWindowLog(`plugin rollback after backend failure: ${error.message}`);
      backend.restart().catch(() => {});
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('plugins:rollback', { message: '插件启动失败，已恢复上一版本' });
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('DeepSeek Harness 启动失败', `${error.message}\n\n日志：${backend.logPath}`);
      app.quit();
    }
  });

  await backend.start();
}

app.whenReady().then(start).catch((error) => {
  dialog.showErrorBox('DeepSeek Harness', error.stack || error.message);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => backend?.stop());
