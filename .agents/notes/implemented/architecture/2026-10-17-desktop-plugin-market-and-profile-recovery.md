# Agent Note: Review community plugins and recover failed Profile mutations

Status: implemented

English | [中文](2026-10-17-desktop-plugin-market-and-profile-recovery.zh.md)

## Problem

Community discovery must not turn catalog commands into desktop privileges. Mutable npm tags can resolve differently between review and installation. Failed package or Host startup operations can leave an instance unusable; restoring configuration alone cannot restore installed dependency bytes.

## Decision

Desktop consumes the awesome-dsh-plugin JSON schema shared by dshmarket. Discovery uses Electron's system-aware HTTP transport, validates external fields, and never evaluates catalog commands. The published catalog JSON on jsDelivr is a transport fallback with its actual source and publisher date displayed. An operator-selected HTTPS source replaces both defaults. Git-only entries remain visible without gaining an alternate installer.

Read-only npm preflight resolves tags to exact versions, compares engines and peers against the bundled runtime, and distinguishes unknown requirements from confirmed mismatches. A single-use, expiring identifier binds the plan to its shell library window. Main-process execution rejects mismatches and unsupported packages independently of renderer controls. Optional author permissions and catalog scan capabilities describe access; they grant or restrict nothing. The `dshmarket` package requires an HTTP Host and owns separate package mutations; Desktop integrates its shared catalog instead of delegating the reserved Profile to that installer.

Each plugin mutation stops the Host under the package lock and copies the full Profile except its held lock into a private snapshot outside the Profile. Regular files are copied independently; symlinks and Windows junctions remain links. A complete snapshot replaces the preceding snapshot before writes begin. Package, validation, build, or startup failure restores files into the original Profile location and awaits the old Host's startup. Failed recovery reports both errors and the snapshot location. The manager reconnects a recovered Host's view while retaining the failed-operation diagnostic.

This partially supersedes failure retention for explicit plugin mutations in the [in-place Profile decision](2026-09-09-desktop-in-place-profile.md). That note retains startup/release reconciliation, package locking, pending-build retry, and the rationale for avoiding activation journals. The [bundled-runtime](2026-09-08-desktop-bundled-runtime-and-external-plugins.md) and [instance-manager](2026-09-16-desktop-instance-manager.md) decisions retain their runtime and isolation responsibilities. None is fully superseded or archived.

The [shell plugin library decision](2026-10-23-shell-plugin-library-and-instance-injection.md) owns installation placement and explicit local/SSH injection; catalog preflight and local Profile recovery remain defined here.

## Alternatives considered

**Load dshmarket's installer directly.** Its Web routes and independent package operations do not preserve Desktop's portless transport, instance ownership, or transaction lock.

**Restore package.json and reinstall.** This depends on network availability and lifecycle builds during recovery and cannot restore modified package files. Full copies buy recovery without another package-manager operation at the cost of disk space and copy time.

**Stage and activate a replacement Profile with a crash journal.** This adds relocation, activation, and interrupted-transaction recovery. In-place mutation with a pre-change copy handles caught errors without a second active Profile or journal format.

## Consequences

Only the latest complete snapshot is retained. Its regular files approximately double the Profile's disk use. External link targets, shared sessions, and effects outside the Profile are not restored. Power loss and forced termination require manual recovery; release reconciliation and destructive reset keep separate semantics. A backup is not a sandbox or an endorsement of community code.

Owner-local renderer expectations cover bilingual install details. Focused tests cover malformed registries, tags, unknown requirements, blocked plans, shell-library single-use confirmation, cancellation, and search. Real subprocess fixtures cover package, validation, build, and startup failures, configuration and dependency-byte restoration, external link preservation, recovery failure, and exclusive package ownership. These checks do not verify arbitrary third-party plugin behavior or constitute signed-application release acceptance.
