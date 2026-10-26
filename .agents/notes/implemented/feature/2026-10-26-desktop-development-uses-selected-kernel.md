# Agent Note: Desktop Development Uses the Selected Kernel

Status: implemented

English | [中文](2026-10-26-desktop-development-uses-selected-kernel.zh.md)

## Problem

The unpackaged Desktop shell previously started local Hosts from a source-linked project. Kernel selection, native dependencies, Web assets, and plugin transactions therefore differed from the packaged application.

## Decision

The development launcher reads the selected runtime from `$DSH_HOME/desktop/agent-manager/kernels/selection.json`. The unpackaged shell checks npm `latest` and prepares any newer release before opening its window, then starts local Hosts, profile package operations, and plugin injection with the verified runtime. Missing selections, mismatched runtime tools, or failed update checks refuse startup. The shell uses the runtime's matching Node.js and the desktop target's pinned pnpm; configured HTTP proxy variables reach Electron registry requests and package operations.

Source-linked runtime generation and local-instance startup are removed. An existing linked package container is detached only after a complete instance-home backup; unknown external package dependencies refuse migration. Session and settings files remain in the instance home. The [independent-kernel decision](../architecture/2026-10-25-independent-desktop-kernel-updates.md) remains active for immutable release preparation, baseline plugins, and kernel data backups; development adds a required pre-window update check.

## Alternatives considered

**Keep the source-linked development project.** It starts quickly, but it tests a different Host graph and cannot exercise the packaged plugin transaction flow.

**Copy the selected runtime into each development home.** This duplicates a large immutable package tree and can leave development instances on different runtime copies.

## Consequences

The shell remains editable from workspace source while Host behavior matches the selected kernel. Development plugin installation uses the same library and per-instance injection path as a packaged shell. New releases require network access at development launch and may reject incompatible plugins. Running Hosts keep their current runtime until the shell restarts. Resolution, migration refusal, development startup ordering, and plugin controls have owner-local tests and a recorded controls snapshot; real development IPC verifies fresh plugin copies and Host reconnection.
