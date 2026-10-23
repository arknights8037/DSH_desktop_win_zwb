/** Check real Linux tmux ownership and survival with a synthetic long-running DSH launcher. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { instanceId } from '../src/instances.ts'
import { remoteReadyUrl, remoteScript, shellQuote } from '../src/remote-scripts.ts'

function run(script: string): string {
  return process.platform === 'win32'
    ? execFileSync('wsl.exe', ['-d', 'Ubuntu', '--', 'sh', '-s'], { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 })
    : execFileSync('sh', ['-s'], { input: script, encoding: 'utf8', timeout: 30_000 })
}
const scratch = run('mktemp -d /tmp/dsh-manager-smoke-XXXXXXXX\n').trim()
assert.match(scratch, /^\/tmp\/dsh-manager-smoke-[A-Za-z0-9]+$/u)
run(`cat > ${shellQuote(scratch + '/dsh')} <<'DSH_FIXTURE'
#!/bin/sh
printf 'dsh web: http://127.0.0.1:12345/?token=fixture-only\n'
exec sleep 120
DSH_FIXTURE
chmod 700 ${shellQuote(scratch + '/dsh')}
`)
const config = {
  id: instanceId(randomUUID()), name: 'tmux smoke', kind: 'ssh' as const, host: 'fixture', port: 22,
  username: 'fixture', auth: 'password' as const, privateKeyPath: '', executable: scratch + '/dsh', home: scratch + '/home',
}
try {
  run(remoteScript(config, 'start'))
  const pane = (): string => run(`tmux -L dsh-agent-manager list-panes -t ${shellQuote('dsh-' + config.id)} -F '#{pane_pid}'\n`).trim()
  const original = pane()
  const deadline = Date.now() + 10_000
  let ready: URL | undefined
  while (!ready && Date.now() < deadline) {
    ready = remoteReadyUrl(run(remoteScript(config, 'read')))
    if (!ready) await delay(50)
  }
  assert.ok(ready, 'tmux launcher announces readiness')
  run(remoteScript(config, 'start'))
  assert.equal(pane(), original, 'reconnecting does not replace the remote process')
  run(`printf wrong-owner > ${shellQuote(config.home + '/.manager-owner')}\n`)
  assert.throws(() => run(remoteScript(config, 'stop')), /ownership mismatch/u)
  assert.equal(pane(), original, 'an ownership mismatch cannot stop the process')
  run(`printf %s ${shellQuote(config.id)} > ${shellQuote(config.home + '/.manager-owner')}\n`)
  run(remoteScript(config, 'stop'))
  assert.throws(() => pane())
  console.log('Linux tmux smoke passed: launch, process survival, reuse, ownership refusal, and stop. This fixture does not execute a real Agent.')
} finally {
  run(`printf %s ${shellQuote(config.id)} > ${shellQuote(config.home + '/.manager-owner')}\n`)
  run(remoteScript(config, 'stop'))
}
