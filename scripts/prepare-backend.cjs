const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'backend-dist');
const source = path.join(root, 'upstream-dsh');
const modules = path.join(target, 'node_modules');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

if (!fs.existsSync(path.join(source, 'apps', 'cli', 'package.json'))) {
  throw new Error(`DeepSeek Harness source checkout is missing: ${source}`);
}

function run(args, cwd = source) {
  const result = spawnSync(pnpm, args, {
    cwd,
    env: {
      ...process.env,
      PNPM_CONFIG_CONFIRM_MODULES_PURGE: 'false'
    },
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

// Rebuild the source packages changed by the desktop integration, then rebuild
// the Web shell that the already-built source CLI serves. Unrelated Harness
// packages remain on their checked-out build artifacts.
run([
  'exec', 'tsc', '-b',
  'packages/host/plugin-inventory',
  'packages/api/remotes',
  'packages/client/ui-layout',
  'packages/client/ui-settings',
  'packages/client/ui-sidebar',
  'packages/client/ui-workspace',
  'packages/client/ui-settings-general',
  'packages/client/ui-settings-plugin-inventory',
  'packages/client/ui-desktop',
  '--force'
]);
run([
  'exec', 'tsdown', '--env.DSH_BUILD_FACE', 'host',
  '--filter', '@deepseek-ai/dsh-host-plugin-inventory'
]);
for (const name of [
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-workspace',
  '@deepseek-ai/dsh-client-ui-settings-general',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
  '@deepseek-ai/dsh-client-ui-desktop'
]) run(['--filter', name, 'run', 'bundle']);
run(['run', 'build:web']);

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
  private: true,
  dependencies: { '@deepseek-ai/dsh': '0.1.1-rc.2', 'simple-git': '3.36.0' },
}, null, 2));

// Install the official release closure first. The Loader resolves several
// profile-only/peer-only Cordis packages dynamically; a filtered workspace
// deploy does not include those packages and consequently fails after
// packaging even though the source checkout works in development.
run([
  'install', '--prod', '--ignore-workspace', '--config.node-linker=hoisted',
  '--config.confirmModulesPurge=false'
], target);

function copyPublishedPayload(relativeSource, packageName, names) {
  const packageSource = path.join(source, relativeSource);
  const packageTarget = path.join(modules, ...packageName.split('/'));
  fs.rmSync(packageTarget, { recursive: true, force: true });
  fs.mkdirSync(packageTarget, { recursive: true });
  for (const name of names) {
    const from = path.join(packageSource, name);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(packageTarget, name), { recursive: true, dereference: true });
  }
}

// Overlay only publishable artifacts rebuilt from the exact tagged source.
// This makes the desktop changes source-owned without copying workspace
// node_modules or weakening the official runtime dependency closure.
for (const row of [
  ['packages/host/plugin-inventory', '@deepseek-ai/dsh-host-plugin-inventory'],
  ['packages/api/remotes', '@deepseek-ai/dsh-api-remotes'],
  ['packages/client/ui-layout', '@deepseek-ai/dsh-client-ui-layout'],
  ['packages/client/ui-settings', '@deepseek-ai/dsh-client-ui-settings'],
  ['packages/client/ui-sidebar', '@deepseek-ai/dsh-client-ui-sidebar'],
  ['packages/client/ui-workspace', '@deepseek-ai/dsh-client-ui-workspace'],
  ['packages/client/ui-settings-general', '@deepseek-ai/dsh-client-ui-settings-general'],
  ['packages/client/ui-settings-plugin-inventory', '@deepseek-ai/dsh-client-ui-settings-plugin-inventory'],
  ['packages/client/ui-desktop', '@deepseek-ai/dsh-client-ui-desktop'],
  ['packages/bundle/web-app', '@deepseek-ai/dsh-web-app'],
]) copyPublishedPayload(row[0], row[1], ['package.json', 'lib', 'cordis.patch.yml', 'README.md', 'README.zh.md']);
copyPublishedPayload('apps/web', '@deepseek-ai/dsh-web-frontend', ['package.json', 'dist']);

fs.copyFileSync(path.join(root, 'src', 'desktop-memory-plugin.cjs'), path.join(target, 'desktop-memory-plugin.cjs'));

function deployedPackage(name) {
  const candidate = path.join(modules, ...name.split('/'));
  if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  throw new Error(`Deployed package is missing: ${name}`);
}

// The upstream Windows picker races ChildProcess `exit` against the final IPC
// message on Windows. Patch the built runtime at staging time until the
// published package carries the upstream fix; also preserve UTF-16 code units
// whose low byte happens to be zero (common in CJK paths).
const pickerRoot = deployedPackage('@deepseek-ai/dsh-host-directory-picker-native');
const pickerIndex = path.join(pickerRoot, 'lib', 'index.js');
const pickerWorker = path.join(pickerRoot, 'lib', 'worker.cjs');
let indexSource = fs.readFileSync(pickerIndex, 'utf8');
if (indexSource.includes('worker.on("exit", () => {')) indexSource = indexSource.replace('worker.on("exit", () => {', 'worker.on("close", () => {');
else if (!indexSource.includes('worker.on("close", () => {')) throw new Error('directory picker worker exit handler not found');
fs.writeFileSync(pickerIndex, indexSource, 'utf8');
let workerSource = fs.readFileSync(pickerWorker, 'utf8');
if (workerSource.includes('bytes[end] !== 0) end += 2')) workerSource = workerSource.replace('bytes[end] !== 0) end += 2', '(bytes[end] !== 0 || bytes[end + 1] !== 0)) end += 2');
else if (!workerSource.includes('(bytes[end] !== 0 || bytes[end + 1] !== 0)')) throw new Error('directory picker UTF-16 terminator code not found');
fs.writeFileSync(pickerWorker, workerSource, 'utf8');
console.log('Patched Windows directory picker IPC close race and UTF-16 decoding');

const entrypoint = path.join(modules, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
if (!fs.existsSync(entrypoint)) throw new Error(`Backend install missing ${entrypoint}`);
console.log(`Prepared backend runtime at ${target}`);
