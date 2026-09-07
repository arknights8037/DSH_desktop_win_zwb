const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.build-app');

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.join(root, 'src'), path.join(stage, 'src'), { recursive: true });
fs.cpSync(path.join(root, 'backend-dist'), path.join(stage, 'backend-dist'), { recursive: true });
fs.cpSync(path.join(root, 'node-runtime'), path.join(stage, 'node-runtime'), { recursive: true });

fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: 'deepseek-harness-desktop',
  version: '0.1.0',
  description: 'Windows desktop client for DeepSeek Harness',
  main: 'src/main.js',
  private: true,
  build: {
    appId: 'ai.deepseek.harness.desktop',
    productName: 'DeepSeek Harness Desktop',
    asar: true,
    files: ['src/**/*', 'package.json'],
    extraResources: [
      {
        from: 'backend-dist',
        to: 'backend',
        filter: ['package.json', 'pnpm-lock.yaml', 'desktop-memory-plugin.cjs']
      },
      {
        from: 'node-runtime',
        to: 'node'
      }
    ],
    directories: { output: path.join('..', 'release') },
    win: {
      target: [{ target: 'nsis', arch: ['x64'] }],
      artifactName: 'DeepSeek-Harness-Desktop-${version}-win-x64.${ext}'
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true
    }
  }
}, null, 2));

console.log(`Staged clean app at ${stage}`);
