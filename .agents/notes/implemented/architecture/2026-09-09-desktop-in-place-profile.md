# Agent Note: Modify the Desktop profile in place

Status: implemented

English | [中文](2026-09-09-desktop-in-place-profile.zh.md)

The [instance manager](2026-09-16-desktop-instance-manager.md) applies these transactions independently inside each local instance home.

## Problem

Staging preserves an old plugin installation but adds profile copying, directory moves, a recovery journal, and rollback state. Ordinary startup and runtime reconciliation need direct profile reuse without a second active installation.

## Decision

Desktop stops the Host and modifies the current profile directly. Shared host links are detached for package changes and restored when the operation settles. Package locking, dependency validation, and approved native builds remain. Compatible upgrades refresh links without copying plugin files.

Runtime reconciliation failures retain partial changes for repair and retry. There is no staging profile, activation journal, or directory-swap recovery. Existing scratch directories are not interpreted or deleted. The [plugin-market recovery decision](2026-10-17-desktop-plugin-market-and-profile-recovery.md) partially supersedes failure retention for explicit plugin mutations: those operations retain a pre-change snapshot and restore handled failures. Runtime reconciliation and reset remain separate operations.

This supersedes staging and rollback in [2026-08-25-electron-desktop-packaging-and-updates](2026-08-25-electron-desktop-packaging-and-updates.md), [2026-09-08-desktop-bundled-runtime-and-external-plugins](2026-09-08-desktop-bundled-runtime-and-external-plugins.md), [2026-09-09-desktop-immediate-window-and-direct-start](2026-09-09-desktop-immediate-window-and-direct-start.md). Other release, module-identity, and window-lifecycle decisions remain active.

A persistent `desktop-packages-pending` marker precedes package writes or native-runtime rebuilding and is removed only after installation, approved builds, and validation succeed. A later launch with that marker reinstalls the locked graph and retries pending builds even when recorded runtime metadata already matches. Ordinary unchanged startups reuse the profile without scanning the plugin dependency graph; package mutations and runtime reconciliation retain validation.

The [shell plugin library](2026-10-23-shell-plugin-library-and-instance-injection.md) supplies independent instance copies and keeps their dependencies outside legacy package-manager mutations.

## Alternatives considered

Staging protects the previous installation at the cost of copying and crash recovery. Versioned directories still need preparation, selection, and cleanup. Direct runtime reconciliation gives up automatic recovery; extending snapshot recovery to application upgrades requires separate release-compatibility and interrupted-upgrade handling.

## Consequences

Tests cover offline initialization, in-place upgrades, pending retry after failed runtime rebuilding, restored host links, and exclusive package ownership. Plugin-mutation recovery follows its linked decision. Signed application and GUI acceptance remain release-environment checks.
