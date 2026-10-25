# Harness Agent Manager

English | [中文](README.zh.md)

## Summary

The Windows desktop application manages independent local and Linux SSH Harness instances. Each tab contains the instance's complete Web UI, including its projects and conversations. Software preferences and model credentials apply to connected and future instances; each instance retains its own plugins, sessions, and specialized configuration.

## Table of Contents

- [Instances](#instances)
- [Plugin catalog and installation](#plugin-catalog-and-installation)
- [Kernel updates and data recovery](#kernel-updates-and-data-recovery)
- [Remote connections](#remote-connections)
- [Lifecycle and storage](#lifecycle-and-storage)
- [Development and packaging](#development-and-packaging)
- [Implementation](#implementation)
- [Known limitations](#known-limitations)

<a id="instances"></a>

## Instances

On first launch, choose **Create a local instance** or **Connect to a remote instance**. The **+** after the tabs offers new local or SSH connections and saved instances for quick connection. **Settings → Instances** opens the saved connection list for opening, editing, or removing definitions. Reopening an existing tab focuses its current view.

Each local instance has an independent Host process and Harness home. Local instances share immutable application runtime packages, but their writable profiles, conversations, settings, browser storage, and plugin installations are separate. Opening a new instance does not import the existing CLI or Desktop data.

Right-click a tab to rename, reconnect, view lifecycle logs, or close it. Rename edits the saved instance name inline: Enter saves and Escape cancels, while the instance keeps running. **Settings**, marked with a gear icon, opens one reusable tab with a full-height sidebar for Application, Instances, Appearance, Keyboard shortcuts, Model credentials, DSH settings, and Plugins. Switch between Settings and instance tabs without disconnecting; closing Settings returns to the selected instance or the welcome page. The frameless window has minimize, maximize/restore, and close buttons to the right of Settings; drag the empty tab-strip area to move it. The content scrolls independently of the sidebar. Shared theme, content font size, language, busy-agent Enter behavior, window shortcuts, and model API keys can be saved without an instance connection.

Software settings are authoritative. Connected instances receive changes through their existing DSH APIs; new or reconnected instances inherit the saved values. Instance preferences never update software preferences. **DSH settings** directly edits software-owned transcript display, Agent mode selection and default preset ID, and DeepSeek protocol, API URL, credential reference, output-token cap, and reasoning effort. **Save and apply** persists the form without a connection and overrides the corresponding instance fields while retaining unrelated configuration. Model fields in one namespace update atomically. The preset ID must exist in each instance; unsupported namespaces or rejected writes appear on this page without closing connections. Native edits to managed fields are replaced on reconnection or the next software settings change. Plugin configuration remains instance-owned.

**Model credentials → Add source** manages multiple independent OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages endpoints, including several sources using the same protocol. Each source has a display name, API base URL, explicit model IDs, context/output-token limits, and its own encrypted key. The URL is the provider's base root, not the full request path; model IDs must match that endpoint. These declarations register separate routes through the instance's `llm-pi-ai` settings. Editing with an empty key retains the saved key. Deleting a source removes its managed route and key, including from offline instances on reconnection, while preserving other providers. Existing standalone credential references remain under **Standalone credentials / DeepSeek key**. Endpoint reachability and real-model responses require the configured service and are not established by saving its definition.

**Appearance** previews a local PNG, JPEG, or WebP wallpaper with an optional color mask, adjustable mask strength, and panel opacity. Images up to 20 MB are resized to at most 1600 pixels and compressed to at most 512 KB. Region colors cover the canvas, top tabs, sidebar, chat content, input, accent, primary text, and secondary text. Presets and versioned JSON color import/export share the same region controls; exports contain colors only. **Save and apply** persists the preview and delivers it to connected instances; **Cancel** restores the saved appearance, and **Restore defaults** previews the base theme until saved. Individual colors can follow the base theme. The shell paints the wallpaper once behind transparent instance views and controls their region colors. The instance sidebar Settings button opens the software settings tab; onboarding stays in the instance. Remote clients need matching semantic color tokens for full visual coverage; older navigation code retains its own settings button. Rejected settings synchronization remains visible independently of appearance.

Appearance drafts preview in existing and newly opened instance views as well as the shell, without writing software or backend settings. Cancel or reloading the manager restores the saved appearance. With a wallpaper enabled, settings cards and instance rows share the content area's fill without adding another opaque layer. The active tab shares the top strip, welcome cards use content opacity, and source text areas use input colors. Menus and dialogs retain solid fills for readability.

Model keys use their provider's credential reference, such as `DEEPSEEK_API_KEY`. The software encrypts keys with the operating system and sends them to each connected local or remote instance's DSH credential store. Saved values are never returned to the settings form. Removing a software-managed key also removes it from offline instances on reconnection. SSH authentication remains separate and is not persisted.

Record a shortcut by focusing its field and pressing the combination; Backspace or Delete disables it. Duplicate bindings are refused, and **Restore defaults** resets all bindings. Shortcuts work while the manager or an instance has focus; they are not system-wide shortcuts.

<a id="plugin-catalog-and-installation"></a>

## Plugin catalog and installation

In a packaged application, open **Settings → Plugins** in the desktop shell. The page omits introductory descriptions; plugin descriptions remain expandable inside padded cards with a separate action column. The community market, search, category filters, and npm lookup appear on the left; retained versions, install review, target selection, and instance controls appear on the right. Narrow windows stack the market above management. Filter the market to installable or retained plugins, clear filters, and use **Manage** on a retained entry to locate its library versions. Each retained entry also offers **Review latest**; new versions still require confirmation. The target selector precedes the version list and requires a new choice if its selected instance becomes unavailable. Installation leaves search, filtering, and settings navigation usable. Package source, integrity, and recovery paths remain available under expandable review details. Review and retain exact npm versions before any instance exists. Local dependency graphs are prepared lazily in the shell library; remote-only packages do not need to install on Windows. Each instance keeps its own deployment and configuration; adding or removing a library version does not update existing copies.

Local kernels from `0.2.0-rc.2` receive `dsh-at-file@0.6.3`, `dsh-context@0.75.1`, and `dsh-cost-meter@1.9.39` on their first eligible initialization. Existing versions and disabled state are retained. Interrupted installation retries before startup; after completion, removed plugins stay removed. All three appear in the same shell library and instance controls.

The shell adapts `dsh-at-file@0.6.3`'s retired browser snapshot-store import to `@deepseek-ai/dsh-client-store` and updates its peer and injection declarations. This adaptation is restricted to that exact version and rejects an unfamiliar import pattern; other plugin versions retain their published code. Tarball-declared private dependencies missing from registry metadata are installed before dependency validation.

The details show the resolved version, npm source, license, repository, integrity, lifecycle scripts, and engine and peer requirements against the shell runtime as reference information. A missing bundle declaration blocks library selection. The target instance validates compatibility when preparing dependencies. Host-owned packages cannot be replaced. Catalog capabilities and permissions are publisher declarations, not a sandbox guarantee.

Confirmation consumes a shell-library plan valid for 15 minutes. Open a local or SSH instance, select it in the library, and choose **Inject / apply version**. The operation prepares an independent copy and restarts only that instance. Existing plugin configuration and activation are preserved. Local instance windows retain activation, removal, and recovery controls.

Local plugin changes snapshot the full Profile to `<instance-home>/desktop/profile-snapshot`, excluding its held lock. Package, validation, build, or startup failure restores that copy and retries the old Host without reinstalling packages. Snapshots need additional disk space and do not restore shared sessions, external files, or plugin side effects outside the Profile. Forced termination and power loss require manual recovery: stop the instance and close the manager, preserve the failed Profile, then copy the snapshot contents into `profiles/desktop`. Profile reset remains destructive and creates no new backup. Local library caches are keyed by runtime; kernel changes prepare injected plugins at their existing exact versions before startup. Incompatible plugins stop preparation with an error.

Remote injection calls the connected instance’s authenticated Web API in the background; all controls remain in global software settings. SSH carries connection and process lifecycle operations only. The remote DSH must include the plugin-deployment API, and pnpm must be available on its PATH. The server prepares a fresh graph with lifecycle scripts disabled and validates Host peers and runtime requirements, then schedules the selected version for restart. Until restart, the active manifest and plugin link remain unchanged. A launch that fails before readiness is restored from its journal on the next launch. Preparation failure keeps the current process running. Old servers report an update requirement rather than falling back to SSH installation scripts.

Discovery uses the [awesome-dsh-plugin catalog](https://awesome-dsh-plugin.com), also consumed by [dshmarket](https://github.com/dsh-market/dsh-market). If the origin fails, Desktop requests the published `dsh-plugin-catalog` JSON through jsDelivr and displays the actual source and publisher date; it does not substitute a bundled or disk-cached catalog. Operators may set `DSH_DESKTOP_PLUGIN_CATALOG_URL` to a credential-free HTTPS JSON source; this replaces both defaults. Failed requests show a reload action. Catalog install-command strings are never executed. Git-only entries remain browseable with repository links, while Desktop installation accepts npm registry packages only. `dshmarket`'s Web routes and independent package manager are not loaded into the portless Desktop Host.

<a id="kernel-updates-and-data-recovery"></a>

## Kernel updates and data recovery

**Settings → Application → DSH kernel** checks the official npm `latest` channel. Automatic preparation is enabled initially; turn it off to use manual checks and **Prepare update**. Updates install separately and must pass a disposable Host, baseline-plugin, Web asset, event-stream readiness, and settings-RPC probe. The selected kernel stays fixed until the application exits. Quit and reopen the application after an update reports readiness; restarting an individual instance does not switch kernels. Preparation failure retains the current selection. Shell installers remain separately managed, and SSH kernels are not updated by this control.

Before an instance first uses a changed runtime, Desktop copies its complete home to `<instance-home>-kernel-backups/backup-*/home`; `complete.json` identifies finished backups and their versions. Configuration, sessions, credentials, and plugin files inside the home are preserved. Browser storage and files outside that home are excluded. Backups contain sensitive data and consume additional disk space. They are retained for manual recovery, not automatically restored or collected. To recover, stop the instance, close Desktop, preserve the changed home, and restore the chosen complete backup to its original home path together with a compatible kernel. Switching only code to an older version does not make newer session or plugin data readable.

Kernels using the newer settings namespaces synchronize theme, language, Enter behavior, model sources, credential references, token limits, and reasoning effort. Legacy transcript, preset, protocol, and official-endpoint controls become read-only for the current local kernel; use the instance UI for its settings and **Model credentials** for custom endpoints. Software preferences for older remote kernels remain saved.

<a id="remote-connections"></a>

## Remote connections

A remote instance requires a Linux SSH account with DSH and tmux already installed. Supply the host, SSH port, username, password or private-key authentication, and DSH executable path. Passwords and private-key passphrases are requested on connection and retained only in the manager process; they are never written to the registry. Private-key file paths are saved, not key contents.

Confirm the server fingerprint on first connection. A changed fingerprint blocks connection. The manager pins server keys by host and port; investigate changes before editing its trust record. The first version accepts explicit host details rather than importing SSH config aliases or jump hosts.

Leave the remote data directory blank for a dedicated directory under `~/.local/share/dsh-manager/instances/<id>`, or supply a dedicated absolute or `~/` path. Existing directories without this instance's ownership marker are refused. Do not use an existing personal Harness home.

The manager starts `dsh --profile web --no-open --port 0` in an owned tmux session. It reads the authenticated startup address through SSH and forwards a local loopback port to the remote loopback listener. The remote instance serves its own matching Web UI. Authentication URLs are excluded from manager logs and configuration.

A lost SSH connection reports unknown remote process state. Reconnecting checks the owned tmux session before starting a process. Explicit **Stop instance** verifies directory and tmux ownership before stopping that session. If startup fails, inspect `.manager-startup.log` inside the remote instance directory; this file contains authentication material and must not be shared.

<a id="lifecycle-and-storage"></a>

## Lifecycle and storage

| Action | Local instance | Remote instance |
|---|---|---|
| Close tab | Close the view; process continues | Disconnect SSH; process continues |
| Disconnect | Detach the view; process continues | Close the tunnel; process state becomes unknown |
| Stop | Stop the selected Host | Stop the owned tmux session over SSH |
| Exit manager | Confirm and stop local Hosts | Disconnect; remote work continues |
| Remove configuration | Stop Host and retain data | Forget connection and retain remote process/data |

The registry and tab layout live at `$DSH_HOME/desktop/agent-manager/instances.json`; software preferences and encrypted model keys live beside it in `software-settings.json`. Local homes are `$DSH_HOME/desktop/agent-manager/instances/<id>`; each contains its own reserved `profiles/desktop`. Browser partitions are keyed by instance ID. Restored tabs connect on selection, and SSH credentials must be re-entered after application exit.

Remote process survival covers manager exit and SSH loss, not server reboot or administrator-enforced session cleanup. Do not delete an instance's data directory while its process is running.

<a id="development-and-packaging"></a>

## Development and packaging

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm run dev:desktop
```

After a successful repository build, `pnpm run start:desktop` launches without rebuilding. Development homes remain under `apps/desktop/.desktop-build/development/home`; external plugin installation requires a packaged application.

The real Electron smoke runs two local Hosts with disposable homes, verifies inherited preferences and test credentials, exercises tabs and shortcuts, and stops both processes:

```powershell
pnpm exec tsx apps/desktop/scripts/smoke-manager.ts
```

For an unsigned Windows test installer:

```powershell
$env:DSH_DESKTOP_APP_ID = 'dev.dsh.agentmanager'
pnpm run package:desktop:win:x64:unsigned
```

The installer is emitted under `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts`. Packaging builds and prepares the bundled fallback runtime before invoking electron-builder. The official shell installer updater is disabled; independent kernel updates use Application settings.

<a id="implementation"></a>

## Implementation

The main process owns an instance registry, one runtime controller per instance, and isolated `WebContentsView` objects. Local requests use the existing framed pipe transport, scoped to each browser partition. SSH instances use `ssh2`; its optional native acceleration is disabled, so the standard JavaScript implementation is used.

Manager and plugin IPC require the exact owned top-level renderer. Local Agent pages receive only the transport marker; remote pages receive no manager preload. Instance pages run sandboxed with Node integration disabled and cannot navigate into manager documents.

See the [multi-instance decision](../../.agents/notes/implemented/architecture/2026-09-16-desktop-instance-manager.md) for lifecycle ownership and alternatives.

<a id="known-limitations"></a>

## Known limitations

Cross-instance task aggregation, scheduling, automatic remote DSH deployment, server reboot recovery, password persistence, and SSH config import are outside this version. Remote plugins that require lifecycle builds need instance-side preparation. Local snapshots and remote copy generations consume disk space and are not automatically collected. Do not run manual package mutations while a deployment is pending.

Automated checks cover authenticated Web requests over an SSH tunnel, independent dependency preparation with real pnpm and a fixture registry, shared Host module identity, and interrupted-launch recovery. They do not replace acceptance on a preinstalled Linux DSH server with real third-party native dependencies and model credentials.

## Dev Note

The unsigned test application uses a separate application ID and does not connect to the official release updater.
