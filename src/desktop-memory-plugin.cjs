const fs = require('node:fs');
const path = require('node:path');

function readState() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(process.env.DSH_HOME, 'desktop-memory.json'), 'utf8'));
    return value && typeof value === 'object' ? value : { system: [], projects: {}, sessions: {} };
  } catch {
    return { system: [], projects: {}, sessions: {} };
  }
}

function textEntries(entries) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => typeof entry?.text === 'string' && entry.text.trim()).map((entry) => entry.text.trim());
}

function sessionTitle(sessionId) {
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(process.env.DSH_HOME, 'storages', 'session_projcache.json'), 'utf8'));
    return cache?.tables?.sessions?.[sessionId]?.rows?.title?.val;
  } catch {
    return undefined;
  }
}

module.exports = function desktopMemoryPlugin(ctx) {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.context({
      name: 'desktop:memory',
      order: 35,
      text: (assemblyContext) => {
        const state = readState();
        const session = assemblyContext?.agent?.session;
        const cwd = session?.header?.cwd;
        const sessionId = session?.id || session?.header?.id || assemblyContext?.agent?.id;
        const projectKey = typeof cwd === 'string' ? cwd : '';
        const sessionKeys = projectKey ? [
          sessionId ? `${projectKey}::${sessionId}` : '',
          sessionId && sessionTitle(sessionId) ? `${projectKey}::${sessionTitle(sessionId)}` : '',
          `${projectKey}::default`
        ].filter(Boolean) : [];
        const values = [
          ...textEntries(state.system),
          ...textEntries(state.projects?.[projectKey]),
          ...textEntries(state.projects?.default),
          ...sessionKeys.flatMap((key) => textEntries(state.sessions?.[key]))
        ];
        const unique = [...new Set(values.map((value) => value.toLocaleLowerCase()))].map((key) => values.find((value) => value.toLocaleLowerCase() === key));
        return unique.length ? `Desktop memory (system > project > session):\n${unique.map((value) => `- ${value}`).join('\n')}` : '';
      }
    });
  });
};
