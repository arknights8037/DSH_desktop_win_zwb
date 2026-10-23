# Agent Note: 直接修改 Desktop profile

Status: implemented

[English](2026-09-09-desktop-in-place-profile.md) | 中文

[实例管理器](2026-09-16-desktop-instance-manager.zh.md)在每个本地实例 home 内独立应用这些事务。

## 问题

staging 能保留旧插件安装，但增加 profile 复制、目录移动、恢复日志和回滚状态。普通启动和运行时校准需要直接复用 profile，不引入第二个活动安装。

## 决策

Desktop 停止 Host 后直接修改当前 profile。修改包前解除宿主共享链接，操作结束后恢复链接。保留包锁、依赖验证和已批准的原生构建。兼容升级只刷新链接，不复制插件文件。

运行时校准失败会保留部分修改，供修复和重试。不使用 staging profile、激活日志或目录切换恢复。已有临时目录不会被解释或删除。[插件市场恢复决策](2026-10-17-desktop-plugin-market-and-profile-recovery.zh.md)部分取代显式插件变更的失败保留行为：这些操作保留变更前快照，并恢复捕获到的失败。运行时校准与重置仍是独立操作。

本决策取代以下记录中的 staging 和回滚：[2026-08-25-electron-desktop-packaging-and-updates](2026-08-25-electron-desktop-packaging-and-updates.zh.md), [2026-09-08-desktop-bundled-runtime-and-external-plugins](2026-09-08-desktop-bundled-runtime-and-external-plugins.zh.md), [2026-09-09-desktop-immediate-window-and-direct-start](2026-09-09-desktop-immediate-window-and-direct-start.zh.md)。其他发布、模块实例和窗口生命周期决策继续有效。

持久的 `desktop-packages-pending` 标记先于包写入或原生运行时重建，仅在安装、获准构建和验证成功后删除。后续启动发现该标记时，会重新安装锁定的依赖图并重试待执行构建，即使记录的运行时元数据已经匹配。普通未变化的启动复用 profile，不扫描插件依赖图；包修改和运行时校准保留验证。

[外壳插件库](2026-10-23-shell-plugin-library-and-instance-injection.zh.md)提供独立实例副本，旧式包管理器变更不修改这些副本的依赖。

## 考虑过的替代方案

staging 以复制和崩溃恢复为代价保护旧安装。版本化目录仍需要准备、选择和清理。直接运行时校准放弃自动恢复；将快照恢复扩展到应用升级需要独立处理发布兼容性与中断升级。

## 后果

测试覆盖离线初始化、原地升级、运行时重建失败后的待处理重试、宿主链接恢复及独占包操作。插件变更恢复遵循链接的决策。签名应用和 GUI 验收仍由发布环境负责。
