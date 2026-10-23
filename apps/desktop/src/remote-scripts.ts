/** POSIX launch commands for preinstalled Linux DSH and tmux. */
import type { InstanceConfig } from './instances.ts'

/** Quote a single POSIX shell argument; no user input becomes shell syntax. */
export function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'` }
/** Build an owner-checked operation on a dedicated remote Harness home. */
export function remoteScript(config: Extract<InstanceConfig, { kind: 'ssh' }>, operation: 'start' | 'read' | 'stop'): string {
  const home = config.home.startsWith('~/') ? `"$HOME"/${shellQuote(config.home.slice(2))}` : shellQuote(config.home)
  const session = `dsh-${config.id}`
  const header = `set -eu
umask 077
home=${home}
owner=${shellQuote(config.id)}
session=${shellQuote(session)}
[ "$(uname -s)" = Linux ] || { echo 'Linux is required' >&2; exit 1; }
command -v tmux >/dev/null || { echo 'tmux is not installed' >&2; exit 1; }
[ ! -L "$home" ] || { echo 'Instance home must not be a symbolic link' >&2; exit 1; }
`
  const ownership = `[ -f "$home/.manager-owner" ] && [ ! -L "$home/.manager-owner" ] && [ "$(cat "$home/.manager-owner")" = "$owner" ] || { echo 'Instance directory ownership mismatch' >&2; exit 1; }
`
  if (operation === 'read') return header + ownership + `tmux -L dsh-agent-manager has-session -t "$session" 2>/dev/null || { echo 'Remote DSH process exited; inspect the remote instance log' >&2; exit 1; }
[ ! -L "$home/.manager-startup.log" ] || exit 1
tail -c 65536 "$home/.manager-startup.log"
`
  if (operation === 'stop') return header + ownership + `if tmux -L dsh-agent-manager has-session -t "$session" 2>/dev/null; then
  [ "$(tmux -L dsh-agent-manager show-options -v -t "$session" @dsh-owner)" = "$owner" ] || { echo 'tmux ownership mismatch' >&2; exit 1; }
  tmux -L dsh-agent-manager kill-session -t "$session"
fi
`
  const launch = `exec env DSH_HOME=${home} ${shellQuote(config.executable)} --profile web --no-open --port 0 > ${home}/.manager-startup.log 2>&1`
  return header + `command -v ${shellQuote(config.executable)} >/dev/null || { echo 'DSH is not installed at the configured executable' >&2; exit 1; }
if [ ! -e "$home" ]; then
  mkdir -p "$(dirname "$home")"
  mkdir -m 700 "$home"
  printf '%s' "$owner" > "$home/.manager-owner"
fi
` + ownership + `chmod 700 "$home"
mkdir "$home/.manager-launch-lock" 2>/dev/null || { echo 'Another startup is active; if it crashed, remove the empty .manager-launch-lock after verifying no startup is running' >&2; exit 1; }
trap 'rmdir "$home/.manager-launch-lock"' EXIT
trap 'exit 130' HUP INT TERM
[ ! -L "$home/.manager-startup.log" ] || exit 1
if tmux -L dsh-agent-manager has-session -t "$session" 2>/dev/null; then
  [ "$(tmux -L dsh-agent-manager show-options -v -t "$session" @dsh-owner)" = "$owner" ] || { echo 'tmux ownership mismatch' >&2; exit 1; }
else
  : > "$home/.manager-startup.log"
  tmux -L dsh-agent-manager new-session -d -s "$session" -c "$home" ${shellQuote(launch)} \\; set-option -t "$session" @dsh-owner "$owner"
fi
`
}
/** Accept only DSH readiness URLs for the remote loopback listener. */
export function remoteReadyUrl(output: string): URL | undefined {
  const matches = [...output.matchAll(/dsh web:\s*(https?:\/\/[^\s\x1b]+)/gu)]
  const value = matches.at(-1)?.[1]
  if (!value) return undefined
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) throw new Error('Invalid remote readiness address')
  return url
}
