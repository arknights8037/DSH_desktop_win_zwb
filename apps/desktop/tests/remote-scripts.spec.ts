import { expect, it } from 'vitest'
import { remoteReadyUrl, remoteScript, shellQuote } from '../src/remote-scripts.ts'
import { instanceId } from '../src/instances.ts'
const config = { id: instanceId('aabbccdd-1234-4321-8123-123456789012'), name: 'Remote', kind: 'ssh' as const, host: 'host', port: 22, username: 'user', auth: 'password' as const, privateKeyPath: '', executable: "/opt/a b/'dsh", home: '~/managed data/instance' }
it('quotes shell arguments and expands only the explicit home prefix', () => {
  expect(shellQuote("a'b;$(evil)")).toBe("'a'\\''b;$(evil)'")
  const script = remoteScript(config, 'start')
  expect(script).toContain('home="$HOME"/\'managed data/instance\'')
  expect(script).toContain('Instance directory ownership mismatch')
  expect(script).toContain('tmux ownership mismatch')
  expect(script).toContain('--no-open --port 0')
})
it('stop is owner-checked and never installs or deletes remote data', () => {
  const script = remoteScript(config, 'stop')
  expect(script).toContain('@dsh-owner')
  expect(script).toContain('kill-session')
  expect(script).not.toContain('rm ')
  expect(script).not.toContain('new-session')
})
it('accepts readiness only from loopback HTTP and retains the authentication query', () => {
  expect(remoteReadyUrl('waiting\ndsh web: http://127.0.0.1:12345/?token=secret\n')?.search).toBe('?token=secret')
  expect(remoteReadyUrl('starting')).toBeUndefined()
  expect(() => remoteReadyUrl('dsh web: http://evil.example:123/')).toThrow('Invalid')
  expect(() => remoteReadyUrl('dsh web: http://user:pass@127.0.0.1:123/')).toThrow('Invalid')
})
