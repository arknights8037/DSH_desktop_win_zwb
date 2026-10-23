# Agent Note: Own Harness processes independently of desktop tabs

Status: implemented

English | [中文](2026-09-16-desktop-instance-manager.zh.md)

## Problem

A desktop client needs to switch among local and remote Agent environments without mixing their credentials, sessions, or plugin installations. A remote task must survive the loss of its desktop connection, while closing the application must not leave locally owned Hosts behind.

## Decision

The manager stores instance definitions separately from open tabs and keeps process state separate from connection state. Every local instance owns a Harness home, Desktop profile, Host controller, and persistent browser partition. Immutable packaged runtime resources remain shared. Each remote instance owns a dedicated home and tmux session on a preconfigured Linux SSH host.

Closing a tab releases its view; it does not stop its Agent. Exiting the manager stops local Hosts and disconnects remote transports. Removing a configuration retains its data. Stop, restart, plugin changes, and profile reset target one stable instance ID. Startup cancellation precedes quiescent cleanup; stale view creation is rejected after close or stop.

Display-name edits preserve the instance ID, open tabs, live connections, and browser views. A label change must not acquire or release runtime ownership. Software preferences are authoritative and persist separately from instance definitions. Connected and future instances inherit appearance, language, and input behavior through revision-fenced DSH settings writes; instance values never update software preferences. Window shortcuts belong to the software and work across its embedded views. Settings occupies one closable shell tab with instance management in its full-height sidebar; application and appearance preferences occupy separate pages with independent content scrolling. Switching or closing Settings changes shell visibility without releasing instance connections. The frameless tab strip has a draggable empty area and non-draggable controls. Authenticated manager IPC operates the Electron window; maximize events synchronize its button state, and window close enters the existing application quit and Host cleanup flow.

Personal appearance uses the same revision-fenced theme settings as the built-in palette. Portable raster data replaces filesystem paths and remote image URLs, so instances need no file access or additional management privileges. The renderer resizes and compresses selected images; both software storage and the instance schema bound image size and accept only raster data URLs and hex colors. Local previews remain drafts until saved. Region and foreground colors become theme-owned semantic tokens, preserving plugin override layers and allowing default restoration to retract every personal token. Color exports omit wallpapers. Older remote theme schemas report synchronization failures instead of receiving injected CSS.

Software model keys use OS encryption at rest and are delivered to each connected instance's existing credential provider. Metadata alone returns to the manager renderer. Removal markers persist until offline instances reconnect, so deleted software keys cannot survive a later connection. The DSH settings form owns explicit non-secret transcript, preset-selection, and DeepSeek overrides, editable before any instance exists. A fixed field allowlist prevents arbitrary RPC and secret configuration; related fields update in one revision-fenced namespace mutation. Software values overwrite managed instance fields on connection and software edits, preserving unrelated fields. Unsupported namespaces and rejected writes remain visible while connections and saved software values survive; supported namespaces continue synchronizing.

Model sources have stable software-assigned owner IDs, independent of their editable names, endpoints, and protocols. Each owner derives one provider route and one encrypted credential reference, so two gateways using the same protocol remain independent. Source configuration and a replacement key commit together; an empty replacement preserves the key. Synchronization mutates only these owned paths in `llm-pi-ai`, never the complete provider map. Deleted owner markers persist for offline instances, preventing a later connection from restoring deleted routes or credentials. Explicit model catalogs let custom endpoints register without importing instance catalogs into software preferences.

Local Web UI requests retain the existing framed-pipe carrier, registered on the instance's browser partition. Remote Web UI traffic uses an authenticated SSH tunnel and the remote server's own client resources. Only exact manager and plugin-window main frames may invoke management IPC. Agent pages do not receive process or SSH privileges.

SSH passwords and key passphrases stay in memory. Host keys are pinned per endpoint after first-use confirmation. Remote lifecycle commands quote paths, check ownership markers and tmux identity, and never install DSH or adopt an unrelated data directory. Explicit [plugin injection](2026-10-23-shell-plugin-library-and-instance-injection.md) prepares a selected plugin in the owned remote profile. Lifecycle logs exclude authentication URLs and session secrets.

This decision partially supersedes the single-profile and shared-data ownership in the [desktop packaging decision](2026-08-25-electron-desktop-packaging-and-updates.md). Its runtime/version discipline remains applicable. The [bundled-runtime decision](2026-09-08-desktop-bundled-runtime-and-external-plugins.md) and [in-place profile decision](2026-09-09-desktop-in-place-profile.md) remain applicable independently within every local home. These records retain independent packaging and transaction rationale and are not archived.

## Alternatives considered

**Project tabs over one backend.** This shares plugin activation, credentials, and runtime failures, so it does not provide independent Agent environments.

**Stop remote tasks when closing their tab.** This ties remote work to the availability of a desktop connection and defeats long-running remote tasks.

**Automatic deployment and a permanent management daemon.** The first version targets preinstalled DSH and tmux; an additional deployment protocol and service lifecycle would enlarge the supported remote environment before connection management is established.

**One client bundle for every remote version.** Serving the remote's own UI preserves its feature presentation. Shared software settings use a small allowlist of existing DSH APIs, while native sections own specialized configuration.

## Consequences

Multiple local Hosts consume more memory than project tabs sharing a process. Remote processes require explicit stopping and are not restored after server reboot. Remote version compatibility is limited to the startup and Web flow verified with the current upstream release. Official automatic updates are disabled for the custom manager.

Registry, lifecycle, IPC, and real SSH protocol tests cover isolation, cancellation, authentication failures, host trust, tunneling, and connection loss. The Electron smoke exercises two actual local Hosts and UI views. Protocol fixtures do not establish real-model remote acceptance; that requires a configured Linux DSH deployment and model credentials.
