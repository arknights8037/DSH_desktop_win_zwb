const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const URL_PATTERN = /dsh web:\s*(http:\/\/127\.0\.0\.1:\d+)/i;

class BackendSupervisor extends EventEmitter {
  constructor({ homeDir, logDir, resourcesPath, isPackaged }) {
    super();
    this.homeDir = homeDir;
    this.logDir = logDir;
    this.resourcesPath = resourcesPath;
    this.isPackaged = isPackaged;
    this.child = null;
    this.restarts = 0;
    this.stopping = false;
    this.logPath = path.join(logDir, 'backend.log');
    this.pluginStatePath = path.join(homeDir, 'desktop-plugins.json');
    this.integrationsStatePath = path.join(homeDir, 'desktop-integrations.json');
  }

  get entrypoint() {
    return this.isPackaged
      ? path.join(this.resourcesPath, 'backend', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      : path.join(__dirname, '..', 'upstream-dsh', 'apps', 'cli', 'lib', 'bin.js');
  }

  get nodeRuntime() {
    return this.isPackaged
      ? path.join(this.resourcesPath, 'node', 'node.exe')
      : path.join(__dirname, '..', 'node-runtime', 'node.exe');
  }

  /**
   * The official sandbox-policy uses process.cwd() as its fallback root for
   * requests without a session cwd. Keep that fallback aligned with the
   * persisted workspace registry instead of the private DSH_HOME directory.
   */
  resolveWorkspaceCwd() {
    const registryPath = path.join(this.homeDir, 'storages', 'workspace.json');
    try {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      const table = registry?.tables?.workspaces ?? {};
      const ids = registry?.global?.workspaceIds ?? Object.keys(table);
      for (const id of ids) {
        const candidate = table[id]?.path;
        if (!candidate) continue;
        try {
          const resolved = fs.realpathSync(candidate);
          if (fs.statSync(resolved).isDirectory()) return resolved;
        } catch {
          // A removed or inaccessible workspace is skipped; the next one may
          // still be valid and should remain eligible as the fallback root.
        }
      }
    } catch {
      // First launch and a partially-written registry safely use homeDir.
    }
    return this.homeDir;
  }

  async start() {
    fs.mkdirSync(this.homeDir, { recursive: true });
    fs.mkdirSync(this.logDir, { recursive: true });
    this.patchPath = path.join(this.homeDir, 'desktop.patch.yml');
    this.writePluginPatch();
    this.workspaceCwd = this.resolveWorkspaceCwd();
    fs.appendFileSync(this.logPath, `desktop workspace cwd: ${this.workspaceCwd}\n`);
    if (!fs.existsSync(this.entrypoint)) {
      throw new Error(`找不到 Harness runtime：${this.entrypoint}`);
    }
    if (!fs.existsSync(this.nodeRuntime)) {
      throw new Error(`找不到独立 Node runtime：${this.nodeRuntime}`);
    }
    this.stopping = false;
    this.spawnChild();
  }

  readPluginState() {
    try {
      const value = JSON.parse(fs.readFileSync(this.pluginStatePath, 'utf8'));
      return value && Array.isArray(value.plugins) ? value : { plugins: [] };
    } catch {
      return { plugins: [] };
    }
  }

  readIntegrationsState() {
    try {
      const value = JSON.parse(fs.readFileSync(this.integrationsStatePath, 'utf8'));
      return value && Array.isArray(value.skillDirs) && Array.isArray(value.mcpServers)
        ? value : { skillDirs: [], mcpServers: [] };
    } catch {
      return { skillDirs: [], mcpServers: [] };
    }
  }

  writePluginPatch() {
    const state = this.readPluginState();
    const integrations = this.readIntegrationsState();
    const lines = ['- id: hmr', '  disabled: true'];
    const memoryPlugin = this.isPackaged
      ? path.join(this.resourcesPath, 'backend', 'desktop-memory-plugin.cjs')
      : path.join(__dirname, '..', 'backend-dist', 'desktop-memory-plugin.cjs');
    if (fs.existsSync(memoryPlugin)) {
      lines.push('- id: desktop-memory');
      lines.push(`  name: ${JSON.stringify(pathToFileURL(memoryPlugin).href)}`);
    }
    for (const plugin of state.plugins || []) {
      if (!plugin?.id || !plugin?.moduleName) continue;
      lines.push(`- id: ${JSON.stringify(plugin.id)}`);
      lines.push(`  name: ${JSON.stringify(plugin.moduleName)}`);
      if (plugin.enabled === false) lines.push('  disabled: true');
    }
    if (integrations.skillDirs.length > 0) {
      lines.push('- id: skill-filesystem');
      lines.push('  disabled: false');
      lines.push('  config:');
      lines.push('    providerName: desktop-filesystem');
      lines.push('    includeDefaultRoots: false');
      lines.push(`    customSkillDirs: ${JSON.stringify(integrations.skillDirs)}`);
    }
    const enabledServers = integrations.mcpServers.filter((server) => server?.enabled !== false);
    if (enabledServers.length > 0) {
      lines.push('- insert:');
      for (const server of enabledServers) {
        lines.push(`    - id: ${JSON.stringify(`desktop-mcp-${server.id}`)}`);
        lines.push("      name: '@deepseek-ai/dsh-mcp-client'");
        lines.push('      config:');
        lines.push(`        serverName: ${JSON.stringify(server.name)}`);
        lines.push(`        transport: ${JSON.stringify(server.transport)}`);
        if (server.transport === 'stdio') {
          lines.push(`        command: ${JSON.stringify(server.command)}`);
          lines.push(`        args: ${JSON.stringify(server.args || [])}`);
          if (server.cwd) lines.push(`        cwd: ${JSON.stringify(server.cwd)}`);
        } else {
          lines.push(`        url: ${JSON.stringify(server.url)}`);
        }
      }
    }
    fs.writeFileSync(this.patchPath || path.join(this.homeDir, 'desktop.patch.yml'), `${lines.join('\n')}\n`, 'utf8');
  }

  applyPluginState() {
    this.writePluginPatch();
  }

  applyIntegrationsState() {
    this.writePluginPatch();
  }

  async restart() {
    if (!this.child) {
      this.stopping = false;
      this.restarts = 0;
      this.workspaceCwd = this.resolveWorkspaceCwd();
      this.writePluginPatch();
      this.spawnChild();
      return;
    }
    this.stopping = true;
    const child = this.child;
    this.child = null;
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 350));
    this.stopping = false;
    this.restarts = 0;
    this.workspaceCwd = this.resolveWorkspaceCwd();
    this.writePluginPatch();
    this.spawnChild();
  }

  spawnChild() {
    const env = {
      ...process.env,
      DSH_HOME: this.homeDir,
      NODE_ENV: 'production'
    };

    this.child = spawn(this.nodeRuntime, [
      '--expose-internals',
      this.entrypoint,
      '--profile', 'web',
      '--patch', this.patchPath,
      '--host', '127.0.0.1',
      '--port', '0',
      '--no-open'
    ], {
      cwd: this.workspaceCwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    const consume = (chunk, isError) => {
      const text = chunk.toString();
      fs.appendFileSync(this.logPath, text);
      const match = text.match(URL_PATTERN);
      if (match) this.emit('status', { type: 'url', url: match[1] });
      if (isError) this.emit('status', { type: 'stderr', text });
    };
    this.child.stdout.on('data', (chunk) => consume(chunk, false));
    this.child.stderr.on('data', (chunk) => consume(chunk, true));
    this.child.once('error', (error) => this.handleExit(error));
    this.child.once('exit', (code, signal) => this.handleExit(new Error(`后台进程退出：code=${code}, signal=${signal}`)));
  }

  handleExit(error) {
    if (this.stopping) return;
    this.child = null;
    if (this.restarts < 3) {
      this.restarts += 1;
      setTimeout(() => this.spawnChild(), 500 * this.restarts);
      return;
    }
    this.emit('fatal', error);
  }

  stop() {
    this.stopping = true;
    if (!this.child || this.child.killed) return;
    this.child.kill();
    this.child = null;
  }
}

module.exports = { BackendSupervisor };
