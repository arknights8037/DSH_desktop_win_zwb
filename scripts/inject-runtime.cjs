const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'backend-dist', 'node_modules');
const target = path.join(root, 'release', 'win-unpacked', 'resources', 'backend', 'node_modules');

if (!fs.existsSync(path.join(source, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
  throw new Error(`Backend runtime is missing: ${source}`);
}
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true, dereference: true });
console.log(`Injected backend runtime at ${target}`);
