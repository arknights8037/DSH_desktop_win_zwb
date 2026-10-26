# Agent Note: Desktop storage inspection and workspace failure recovery

Status: implemented

English | [中文](2026-10-25-desktop-storage-and-workspace-recovery.zh.md)

## Problem

The desktop manager had no way to show where its local data lived or how much space its settings, instances, package cache, and plugin library used. A workspace selection that failed during connection also returned to the picker without exposing the failure or offering a retry, so an unavailable workspace looked like a page that had failed to open. Instance removal also had no explicit choice between retaining and permanently deleting a local home.

## Decision

The desktop Settings page includes a read-only Storage tab. Its manager IPC operation reports recursive byte totals for manager-owned files, local instance data, the pnpm cache, and the plugin library, plus per-local-instance totals. The manager-owned total excludes the instance and plugin-library directories so the displayed total is the sum of the four categories. Directory traversal ignores symbolic links and treats a missing directory as empty. Each category can be opened in the operating-system file manager; the page never deletes sessions or other stored data. Removing a local instance retains its home by default. The confirmation dialog can request deletion of that instance home after the Host stops; remote instance data cannot be deleted locally. Cleanup unlinks owned files and directory links without following their targets, and the registry entry is removed only after cleanup succeeds.

Workspace selection keeps the existing connection lifecycle and records a failed selection in the conversation hero. The error text is shown to the user and a retry action repeats the same workspace selection. A later selection clears the previous failure.

## Alternatives considered

**Add deletion and cleanup controls to the first storage page.** Rejected: storage inspection should not mix with destructive retention choices for caches and the plugin library. The instance removal confirmation owns the narrower local-home deletion decision, while the Storage page remains read-only.

**Log workspace failures without changing the conversation UI.** Rejected: the manager and connection logs are not visible at the point where a user is blocked, and they do not provide a direct retry action.

**Retry workspace connections automatically.** Rejected: an automatic retry could repeat authentication, network, or configuration failures without user intent. The page reports the actual error and lets the user choose when to retry.

## Consequences

Storage readings can take time for large directories, so the page has loading and unavailable states. The byte totals are a snapshot and do not reserve space or predict future growth. Workspace failures remain transient UI state; the underlying session and connection events remain unchanged.

## Testing

The manager renderer test covers the Storage tab, category totals, local-instance rendering, and the open-directory operation. Conversation skeleton tests cover the failure message and retry control. Desktop and conversation TypeScript checks pass, and the focused desktop startup, manager renderer, and conversation suites pass together.
