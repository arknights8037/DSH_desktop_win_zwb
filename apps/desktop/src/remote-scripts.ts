/** POSIX commands for an owned, detached Linux DSH process. */
import type { InstanceConfig } from './instances.ts'
import { remoteSessionImport } from './remote-session-import.ts'

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
operation=${shellQuote(operation)}
[ "$(uname -s)" = Linux ] || { echo 'Linux is required' >&2; exit 1; }
[ ! -L "$home" ] || { echo 'Instance home must not be a symbolic link' >&2; exit 1; }
`
  const ownership = `[ -f "$home/.manager-owner" ] && [ ! -L "$home/.manager-owner" ] && [ "$(cat "$home/.manager-owner")" = "$owner" ] || { echo 'Instance directory ownership mismatch' >&2; exit 1; }
`
  const initialize = operation === 'start' ? `
if [ ! -e "$home" ]; then
  mkdir -p "$(dirname "$home")"
  mkdir -m 700 "$home"
  printf '%s' "$owner" > "$home/.manager-owner"
fi
` : ''
  const common = header + initialize + ownership + `chmod 700 "$home"
for file in .manager-startup.log .manager-process .manager-process.next .manager-process.lock .manager-session-import.json; do
  [ ! -L "$home/$file" ] && { [ ! -e "$home/$file" ] || [ -f "$home/$file" ]; } || { echo 'Invalid remote lifecycle file' >&2; exit 1; }
done
command -v flock >/dev/null || { echo 'Linux flock is required for remote process management' >&2; exit 1; }
exec 9>"$home/.manager-process.lock"
flock -w 5 9 || { echo 'Another remote lifecycle operation is active' >&2; exit 1; }
# Preserve processes started by older managers; new launches do not use tmux.
if command -v tmux >/dev/null && tmux -L dsh-agent-manager has-session -t "$session" 2>/dev/null; then
  ${operation === 'start' && config.sessionSource ? `[ -f "$home/.manager-session-import.json" ] || { echo 'Stop the target instance before importing sessions into a new data directory' >&2; exit 1; }` : ':'}
  [ "$(tmux -L dsh-agent-manager show-options -v -t "$session" @dsh-owner)" = "$owner" ] || { echo 'tmux ownership mismatch' >&2; exit 1; }
  case "$operation" in
    read) tail -c 65536 "$home/.manager-startup.log" ;;
    stop) tmux -L dsh-agent-manager kill-session -t "$session" ;;
  esac
  exit 0
fi
boot=$(cat /proc/sys/kernel/random/boot_id)
process_identity() {
  [ -r "/proc/$pid/stat" ] || return 1
  stat=$(cat "/proc/$pid/stat" 2>/dev/null) || return 1
  stat=\${stat##*) }
  set -f
  set -- $stat
  [ "$1" != Z ] && [ "$1" != X ] && [ "\${20}" = "$started" ] || return 1
  [ "$3" = "$pid" ] && [ "$4" = "$pid" ] || { echo 'Remote process group ownership mismatch' >&2; exit 1; }
}
running() {
  [ -s "$home/.manager-process" ] || return 1
  read -r pid started process_boot < "$home/.manager-process" || { echo 'Invalid remote process record' >&2; exit 1; }
  case "$pid" in ''|*[!0-9]*|0|1) echo 'Invalid remote process ID' >&2; exit 1 ;; esac
  [ "$process_boot" = "$boot" ] || return 1
  process_identity || return 1
  if ! tr '\\000' '\\n' < "/proc/$pid/environ" | grep -Fx "DSH_MANAGER_OWNER=$owner" >/dev/null; then
    process_identity || return 1
    echo 'Remote process ownership mismatch' >&2; exit 1
  fi
}
`
  if (operation === 'read') return common + `running || { echo 'Remote DSH process exited; inspect the remote instance log' >&2; exit 1; }
tail -c 65536 "$home/.manager-startup.log"
`
  if (operation === 'stop') return common + `if running; then
  kill -TERM "-$pid"
  attempts=0
  while running; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 100 ] || { echo 'Remote DSH did not stop within 10 seconds; inspect the remote instance log' >&2; exit 1; }
    sleep 0.1
  done
fi
: > "$home/.manager-process"
`
  // The detached child records its own session leader, including when setsid forks.
  const launch = `set -eu
cd "$DSH_HOME"
stat=$(cat /proc/$$/stat)
stat=\${stat##*) }
set -f
set -- $stat
printf '%s %s %s\\n' "$$" "\${20}" "$(cat /proc/sys/kernel/random/boot_id)" > .manager-process.next
mv -f .manager-process.next .manager-process
exec 9>&-
exec ${shellQuote(config.executable)} --profile web --no-open --port 0`
  const source = config.sessionSource?.startsWith('~/') ? `"$HOME"/${shellQuote(config.sessionSource.slice(2))}` : shellQuote(config.sessionSource ?? '')
  const inherit = config.sessionSource ? `
if [ ! -f "$home/.manager-session-import.json" ] && running; then
  echo 'Stop the target instance before importing sessions into a new data directory' >&2; exit 1
fi
command -v node >/dev/null || { echo 'Node.js must be available on the SSH PATH to import sessions' >&2; exit 1; }
printf '%s\\n' 'dsh-manager-phase:remoteImport'
node - ${source} "$home" "$owner" <<'DSH_SESSION_IMPORT'
${remoteSessionImport}
DSH_SESSION_IMPORT
` : ''
  return common + `printf '%s\\n' 'dsh-manager-phase:remotePrepare'
${!config.sessionSource ? `[ ! -e "$home/.manager-session-import" ] || { echo 'An unfinished session import must be resumed before starting DSH' >&2; exit 1; }` : ''}
command -v ${shellQuote(config.executable)} >/dev/null || { echo 'DSH is not installed at the configured executable' >&2; exit 1; }
for tool in nohup setsid; do
  command -v "$tool" >/dev/null || { echo "Linux $tool is required for background startup" >&2; exit 1; }
done
${inherit}
printf '%s\\n' 'dsh-manager-phase:remoteStart'
if running; then exit 0; fi
: > "$home/.manager-process"
nohup setsid -f env DSH_HOME="$home" DSH_MANAGER_OWNER="$owner" sh -c ${shellQuote(launch)} < /dev/null > "$home/.manager-startup.log" 2>&1 &
attempts=0
until running; do
  attempts=$((attempts + 1))
  [ "$attempts" -lt 50 ] || { echo 'Remote background startup failed; inspect the remote instance log' >&2; exit 1; }
  sleep 0.1
done
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
