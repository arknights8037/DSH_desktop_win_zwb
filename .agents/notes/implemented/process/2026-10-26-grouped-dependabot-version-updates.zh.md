# Agent Note: Dependabot 常规版本更新分组

Status: implemented

[English](2026-10-26-grouped-dependabot-version-updates.md) | 中文

## 问题

逐个依赖更新会在桌面仓库中同时生成大量分支和重复的 CI 运行。现有检查还依赖上游 runner 池、仓库地址和发布基础设施，因此分支可以合并并不代表更新在本仓库中可用。

## 决策

每个已配置的生态将所有常规版本更新合并为一个 PR，并且最多允许一个未关闭的常规版本更新 PR。npm、Python SDK 和 GitHub Actions 分别审查。现有检查计划、冷却时间、标签和 vendor 源码排除规则继续生效。分组明确只选择常规版本更新；GitHub 安全更新保留独立策略和数量限制，见 [Dependabot 配置选项](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#open-pull-requests-limit)。

依赖更新必须通过相关检查才能合并。未验证的单项更新尝试会关闭并删除对应分支；PR 保留提议的差异。仓库自身的 CI 失败需要与依赖兼容性分别诊断。[Dependabot 密钥访问规则](../testing/2026-06-19-real-api-e2e-ci.zh.md)和 [runner 故障切换策略](2026-07-26-ci-failover-runbook.zh.md)继续生效。

## 曾考虑的替代方案

**合并所有没有冲突的更新。** 否决：没有冲突不能验证依赖 API、相关包版本是否一致、运行时要求或发布构建。

**停用所有依赖更新。** 否决：分组可以限制常规审查工作量，同时保留发现更新的能力。

## 后果

三个已配置的生态最多同时生成三个常规版本更新 PR。分组后的差异可能更大，仍需审查兼容性；分组不会启用自动合并。安全更新 PR 可以超过常规版本更新数量限制。失败的单项尝试仍保留在 GitHub 历史中，供诊断或重新考虑。
