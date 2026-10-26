# Agent Note: Desktop Development Uses the Selected Kernel

Status: implemented

[English](2026-10-26-desktop-development-uses-selected-kernel.md) | 中文

## Problem

未打包的 Desktop 外壳此前从源码链接项目启动本地 Host。因此，内核选择、原生依赖、Web 资源和插件事务都与打包应用不同。

## Decision

开发启动器从 `$DSH_HOME/desktop/agent-manager/kernels/selection.json` 读取已选 runtime。未打包的外壳在打开窗口前检查 npm `latest` 并准备任何更新版本，随后使用验证通过的 runtime 启动本地 Host、执行 profile 包操作和注入插件。缺少选择记录、runtime 工具不匹配或更新检查失败时拒绝启动。外壳使用 runtime 配套的 Node.js 和桌面目标固定版本的 pnpm；配置的 HTTP 代理环境变量会传给 Electron 注册表请求和包操作。

源码链接 runtime 的生成流程及本地实例启动分支已移除。已有的链接包容器仅在完整备份实例 home 后断开；未知外部包依赖会阻止迁移。会话与设置文件保留在实例 home 中。[独立内核决策](../architecture/2026-10-25-independent-desktop-kernel-updates.zh.md) 继续约束不可变发布版本准备、默认插件和内核数据备份；开发版额外要求在打开窗口前检查更新。

## Alternatives considered

**保留源码链接的开发项目。** 它启动较快，但测试的是不同的 Host 依赖图，也无法覆盖打包版使用的插件事务流程。

**把已选 runtime 复制到每个开发 home。** 这会复制大型的不可变依赖树，还可能使不同开发实例使用不同的 runtime 副本。

## Consequences

外壳仍从工作区源码加载，同时 Host 行为与已选内核一致。开发版使用与打包版相同的插件库和实例注入流程。开发启动需要访问网络，新发布版本可能拒绝不兼容的插件。已运行的 Host 会继续使用当前内核，直到外壳重启。内核解析、迁移拒绝、开发启动顺序和插件控件均有所属目录的测试与控件快照覆盖；真实开发版 IPC 验证独立插件副本生成和 Host 重连。
