# Agent Note: Own plugin installations in the shell and deploy independent instance copies

Status: implemented

English | [中文](2026-10-23-shell-plugin-library-and-instance-injection.zh.md)

## Problem

Installing plugins separately through each instance couples discovery and version management to instance availability. Sharing mutable plugin directories instead makes a library update change running instances and prevents independent dependency versions. Windows native dependencies cannot serve a Linux SSH Host.

## Decision

Global software settings in the desktop shell own the plugin library, community market, version review, and instance injection. These controls do not move into the DSH Web settings page. The library retains exact version selections independently of platform installation. Local dependency caches are prepared lazily and keyed by application runtime identity. Main-process authorization accepts library changes only from the exact owned manager document and its top-level frame. Adding or removing a library version never mutates existing instance deployments.

The plugin settings page embeds one shared plugin controller: market and search on the left, library versions, review, and instance deployment on the right. Narrow windows stack these columns. DOM identifiers, queries, and busy controls are scoped to the panel; deployment controls retain their manager-owned availability. Separate local instance windows reuse the controller for activation and recovery. The manager preload exposes plugin operations without granting them to instance content or subframes. Search and local filtering remain available while a mutation is pending; all mutation controls remain locked. Retained-package badges and links to library versions avoid duplicate discovery work, while latest-version review keeps updates explicit. If a chosen target becomes unavailable, refresh clears that choice instead of selecting another instance. Package source and recovery metadata remain accessible in expandable review details.

Local injection copies the selected graph and its lockfile into the selected Profile, excluding application-owned Host packages. A managed top-level link points only to that Profile's independent copy. Host peers retain the application's module identity; private dependencies resolve from the copied graph. Legacy pnpm mutations exclude injected dependencies and restore their links afterward. Configuration remains instance-owned, and replacement retains local activation state. The library holds its source until deployment settles; application exit awaits that operation.

Remote injection sends prepare and apply requests through the instance’s authenticated Web Connection. The remote launcher prepares a separate graph under the active profile, using that host’s pnpm and installation-owned Host packages; lifecycle scripts remain disabled. Apply persists a restart request without changing running modules. At the next launch, the launcher replaces the selected package link and manifest and confirms the journal only after readiness. An unfinished applying journal restores the preceding link and manifest on the following launch. Configuration and disabled state survive replacement. SSH performs tunnel and process lifecycle operations only; it never receives plugin installation or restoration scripts. A server lacking this API requires an update, with no SSH installer fallback.

This partially supersedes installation placement in the [bundled-runtime decision](2026-09-08-desktop-bundled-runtime-and-external-plugins.md), mutation handling in the [in-place Profile decision](2026-09-09-desktop-in-place-profile.md), plan ownership in the [market decision](2026-10-17-desktop-plugin-market-and-profile-recovery.md), and remote package-operation scope in the [instance-manager decision](2026-09-16-desktop-instance-manager.md). Their runtime identity, locking, catalog validation, recovery, and lifecycle rationale remain active; none is fully superseded.

## Alternatives considered

**Share mutable library directories with instances.** This avoids copying but makes updates implicit and couples running instances to library removal and file writes.

**Keep npm installation in each instance window.** This preserves the existing installer but leaves installation ownership distributed across instances and mixes dependency graphs during updates.

**Copy the Windows dependency graph to SSH instances.** Native binaries and platform-selected dependencies cannot run on Linux. Target-side preparation trades identical dependency bytes for platform compatibility.

## Consequences

Independent copies and local snapshots consume disk space and are not automatically collected. Platform-independent selections let Linux-only plugins reach remote preparation without a Windows installation. The [independent kernel decision](2026-10-25-independent-desktop-kernel-updates.md) partially supersedes explicit reinjection on local runtime changes: startup prepares existing exact versions after a complete-home backup. Remote preparation requires preinstalled DSH, tmux, and pnpm; packages needing lifecycle builds require separate instance-side preparation. Profile edits during a pending deployment are rejected rather than overwritten. The activation journal records link and manifest changes, not external plugin side effects or session data.

Owner-local bilingual renderer expectations cover the global library and instance selection. Filesystem fixtures cover independent copies, conflicting private dependency versions, disabled replacement, and startup rollback. Authenticated HTTP tests boot the API through a real Loader tree and verify authorization, payload rejection, and route disposal. SSH protocol fixtures verify Web RPCs over the tunnel and reject installation shell commands. A real-pnpm registry fixture verifies private dependency preparation, disabled lifecycle scripts, and shared Host module identity. Linux-native packages and arbitrary third-party behavior remain deployment acceptance requirements.
