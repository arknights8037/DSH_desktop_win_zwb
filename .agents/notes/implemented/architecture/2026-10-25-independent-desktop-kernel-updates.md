# Agent Note: Stage independent Desktop kernel updates before opening instance data

Status: implemented

English | [中文](2026-10-25-independent-desktop-kernel-updates.zh.md)

## Problem

Community plugins can require a newer DSH than the Desktop installer contains. Replacing packages beneath a running Host changes module identity and native dependencies without a process restart. A Profile snapshot does not protect session files or plugin data elsewhere in the instance home.

## Decision

The shell owns a separate kernel store and checks the official npm `latest` channel at application launch. Automatic preparation defaults to enabled and can be disabled in Application settings. Preparation installs an exact version beside the bundled fallback, copies the shell's private portless bridge, inventories the resulting files, and starts a disposable instance with the three baseline plugins. HTML delivery and settings RPCs must succeed before selection is published. Running instances keep the kernel selected at application startup; prepared updates take effect at the next application launch. A selected release is verified against its inventory and re-prepared when the shell bridge or bundled execution tools change. Unsupported releases fail preparation and retain the previous selection.

Before a stopped local instance changes runtime identity, the shell copies its complete home into a sibling recovery directory. It prepares every injected plugin at its existing exact version for the selected kernel, retaining configuration and disabled state. Incompatibility refuses startup rather than choosing another plugin version. Recovery backups include instance-local sessions and plugin files, but cannot capture external paths, browser partitions, or remote server data. Returning to older code after newer data writes requires coordinated data recovery; the shell exposes no code-only downgrade button.

The native shell market continues to use the community catalog shared with dshmarket. It owns version selection, local installation, and instance deployment; dshmarket's Web backend is not mounted. Eligible local instances receive `dsh-at-file`, `dsh-context`, and `dsh-cost-meter` once. An interrupted initialization retries missing installations. A completion marker preserves subsequent user removal and disabled state. Existing versions are retained. Remote kernels and baseline installation remain server-owned.

Plugin preparation keeps automatic Host peer installation disabled. Host packages resolve through the selected runtime; required private peers and tarball-declared private dependencies are reconciled through pnpm package extensions before graph validation. This handles registry metadata that omits dependencies present in the downloaded archive without borrowing dependencies from an ancestor project. Prerelease kernels participate in declared semver ranges; incompatible ranges still reject deployment.

The published `dsh-at-file@0.6.3` browser bundle imports `createSnapshotStore` from the retired `dsh-client-runtime/client` entry. Its exact-version adapter replaces that import with `dsh-client-store` and updates the corresponding peer and client injection declarations. An unfamiliar import pattern fails installation. This keeps the current kernel's shared store implementation instead of installing an obsolete runtime graph; other versions are not rewritten.

The bridge adapts legacy streams and the newer Gateway's explicit owner Peer, input iterable, and cancellation signal. Duplex streams send one input frame per acknowledged Fetch request; a second pending write is rejected, and cancelling output releases pending input. Kernel preparation requires an event-stream readiness frame before publication. Browser transport tests cover ordered duplex input, consumption acknowledgements, and cancellation while the input producer waits.

This partially supersedes release coupling in the [bundled-runtime decision](2026-09-08-desktop-bundled-runtime-and-external-plugins.md) and explicit reinjection on runtime changes in the [library decision](2026-10-23-shell-plugin-library-and-instance-injection.md). Both remain active for fallback packaging, package identity, independent deployments, and transaction ownership. The [in-place Profile decision](2026-09-09-desktop-in-place-profile.md), [market decision](2026-10-17-desktop-plugin-market-and-profile-recovery.md), and [instance-manager decision](2026-09-16-desktop-instance-manager.md) retain their independent locking, catalog, recovery, and SSH rationale; none is fully superseded.

## Alternatives considered

**Update packages inside running instances.** This can mix package generations within a process and gives each instance separate installation ownership.

**Treat a Profile rollback as a kernel downgrade.** It excludes session generations and plugin data outside the Profile, so it cannot establish compatibility with older readers.

**Embed dshmarket's installer.** Its Web routes and independent package operations conflict with the portless shell's installation ownership.

## Consequences

Independent releases, plugin graphs, and complete home backups consume disk space and are not automatically collected. Initial preparation needs npm access and approved native builds. Disposable startup establishes transport and plugin composition compatibility, not arbitrary third-party migrations or real-model behavior. Owner-local tests cover deferred selection, failed preparation, concurrent requests, baseline retry/removal, same-version reinjection, retained activation, and complete-home backup. Signed installer upgrades, macOS native execution, external plugin side effects, remote servers, and model-provider acceptance remain release qualification requirements.
