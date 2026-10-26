# Agent Note: Grouped Dependabot Version Updates

Status: implemented

English | [中文](2026-10-26-grouped-dependabot-version-updates.zh.md)

## Problem

Independent dependency updates generate many simultaneous branches and duplicate CI runs in the desktop repository. Existing checks also depend on upstream runner pools, repository addresses, and release infrastructure, so a mergeable branch does not establish that an update works in this repository.

## Decision

Each configured ecosystem groups all version updates into one pull request and permits at most one open version-update pull request. npm, the Python SDK, and GitHub Actions remain separate review units. The existing schedule, cooldown, labels, and vendored-source exclusion continue to apply. Groups explicitly select version updates; GitHub security updates retain their separate policy and limit under the [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#open-pull-requests-limit).

Dependency updates require relevant passing checks before merging. The unverified individual update attempts are closed and their branches removed; their pull requests retain the proposed diffs. Repository-specific CI failures require diagnosis independently of dependency compatibility. The [Dependabot secret-access rule](../testing/2026-06-19-real-api-e2e-ci.md) and [runner failover policy](2026-07-26-ci-failover-runbook.md) remain active.

## Alternatives considered

**Merge every conflict-free update.** Rejected because conflict resolution does not verify dependency APIs, coordinated package versions, runtime requirements, or release builds.

**Disable all dependency updates.** Rejected because grouping bounds routine review work while retaining update discovery.

## Consequences

The three configured ecosystems can produce at most three simultaneous version-update pull requests. Grouped diffs can be larger and still require compatibility review; grouping does not enable automatic merging. Security-update pull requests can exceed the version-update limit. Individual failed attempts remain available in GitHub history for diagnosis or reconsideration.
