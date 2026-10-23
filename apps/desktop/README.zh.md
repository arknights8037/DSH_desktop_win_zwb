# Harness Agent 管理器

[English](README.md) | 中文

## 概要

Windows 桌面应用管理相互独立的本地和 Linux SSH Harness 实例。每个标签页包含该实例的完整 Web UI，包括项目和对话。软件偏好和模型凭据应用于已连接及后续连接的实例，各实例保留自己的插件、会话和专有配置。

## 目录

- [实例](#instances)
- [插件目录与安装](#plugin-catalog-and-installation)
- [远程连接](#remote-connections)
- [生命周期与存储](#lifecycle-and-storage)
- [开发与打包](#development-and-packaging)
- [实现](#implementation)
- [已知限制](#known-limitations)

<a id="instances"></a>

## 实例

首次启动时，选择**创建本地实例**或**连接远程实例**。标签页后面的 **+** 提供新建本地或 SSH 连接，以及已保存实例的快速连接入口。**设置 → 实例管理**打开已保存的连接列表，可打开、编辑或移除配置。再次打开已有标签页会聚焦其当前视图。

每个本地实例拥有独立的 Host 进程和 Harness home。本地实例共享应用内不可变的运行时包，可写 profile、对话、设置、浏览器存储和插件安装相互隔离。新实例不会导入已有 CLI 或 Desktop 数据。

右键标签页可重命名、重新连接、查看生命周期日志或关闭标签页。重命名直接在标签内编辑已保存的实例名称：Enter 保存，Escape 取消，实例保持运行。带齿轮图标的**设置**打开可复用的独立标签页，全高侧栏分为应用、实例管理、外观、快捷键、模型凭据、DSH 设置和插件，右侧内容独立滚动。设置与实例标签可相互切换，实例保持连接；关闭设置后返回当前实例或欢迎页。无原生边框的窗口在设置右侧提供最小化、最大化／还原和关闭按钮，拖动标签栏空白区域可移动窗口。共享主题、内容字号、语言、Agent 忙碌时的 Enter 行为、窗口快捷键和模型 API Key 均可在未连接实例时保存。

软件设置是统一来源。已连接的实例通过现有 DSH API 接收变更，新建或重新连接的实例继承已保存的值。实例偏好不会更新软件偏好。**DSH 设置**直接编辑软件保存的轮次显示方式、Agent 模式选择和默认预设 ID，以及 DeepSeek 的协议、API 地址、凭据名称、输出 Token 上限与推理强度。**保存并应用**可在未连接时保存表单，覆盖实例对应字段并保留其他配置；同一命名空间内的模型字段原子更新。预设 ID 必须在各实例中存在；不支持的命名空间和被拒绝的写入会显示在此页，不会关闭连接。在原生页面修改受管理字段后，重新连接或下次修改软件设置时会再次覆盖。插件配置仍归实例管理。

**模型凭据 → 添加来源**可管理多个独立的 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages 接口，同一协议也可添加多个来源。每组来源具有显示名称、API 基础地址、明确的模型 ID、上下文与输出 Token 上限，以及独立加密的密钥。地址填写服务的基础路径，而非完整请求路径；模型 ID 必须与接口支持的值一致。这些声明通过实例的 `llm-pi-ai` 设置注册为独立路由。编辑时密钥留空会保留原值。删除来源会移除其受管理路由和密钥，离线实例在重连时同步删除，其他提供方保持不变。已有独立凭据名称仍可在**独立凭据 / DeepSeek 密钥**中管理。保存定义不代表接口可达或真实模型可用，实际响应取决于配置的服务。

模型 Key 使用提供方的凭据引用名，例如 `DEEPSEEK_API_KEY`。软件通过操作系统加密 Key，并将其发送到各个已连接的本地或远程实例的 DSH 凭据存储。已保存的值不会返回设置表单。移除软件管理的 Key 后，离线实例在重新连接时也会移除它。SSH 认证单独处理，不持久化保存。

聚焦快捷键输入框并按下组合键即可录制，Backspace 或 Delete 可禁用该操作。重复绑定会被拒绝，**恢复默认**可重置全部绑定。管理器或实例拥有焦点时均可使用快捷键，它们不注册为系统全局快捷键。

<a id="plugin-catalog-and-installation"></a>

## 插件目录与安装

在打包后的桌面外壳中打开**设置 → 插件 → 打开插件库与市场**，统一管理插件版本。没有实例时也可审阅并保留精确 npm 版本。本地依赖图在外壳插件库中按需准备，远端专用插件不必先在 Windows 安装。各实例独立保留部署和配置，添加或移除库中版本不会更新已有副本。

详情展示解析后的版本、npm 来源、许可证、仓库、完整性、生命周期脚本，以及相对于外壳运行时的 engine 和 peer 要求，供用户参考。缺少 bundle 声明会阻止加入插件库。目标实例在准备依赖时校验兼容性，不允许替换 Host 拥有的包。目录中的能力和权限属于发布者声明，并非沙箱保证。

确认会消耗一份有效期为 15 分钟的外壳插件库计划。打开本地或 SSH 实例，在插件库中选定它，再选择**注入 / 应用版本**。操作会准备独立副本，仅重启该实例，并保留已有插件配置和启用状态。本地实例窗口保留启用、移除和恢复操作。

本地插件变更将完整 Profile 备份到 `<instance-home>/desktop/profile-snapshot`，排除正在持有的锁。包操作、校验、构建或启动失败时恢复副本并重试原 Host，无需重新安装包。快照需要额外磁盘空间，不恢复共享会话、外部文件和插件在 Profile 之外的副作用。强制结束或断电需要手动恢复：停止实例并关闭管理器，保留失败 Profile，再将快照内容复制到 `profiles/desktop`。Profile 重置仍为破坏性操作，不创建新备份。本地插件库缓存按应用运行时区分；运行时变化后，下次显式注入会准备新缓存。需要替换多个不兼容实例副本时可先禁用它们。

远端注入在后台调用已连接实例的认证 Web API，所有操作入口仍位于全局软件设置。SSH 仅承载连接和进程启停。远端 DSH 必须包含插件部署 API，且 PATH 中需有 pnpm。服务端在禁用生命周期脚本的情况下准备全新依赖图，校验 Host peer 和运行时要求，再安排选定版本在重启时生效。重启前不会改变当前清单和插件链接。若启动在就绪前失败，下次启动会根据日志恢复。准备失败保留当前进程。旧服务端会提示更新，不会退回 SSH 安装脚本。

发现功能使用 [awesome-dsh-plugin 目录](https://awesome-dsh-plugin.com)，与 [dshmarket](https://github.com/dsh-market/dsh-market) 共用数据。主站失败时，桌面端通过 jsDelivr 请求已发布的 `dsh-plugin-catalog` JSON，显示实际来源与发布方日期，不用内置目录或磁盘缓存替代。运维可设置 `DSH_DESKTOP_PLUGIN_CATALOG_URL`，指定不含凭据的 HTTPS JSON 来源，此设置替换两个默认来源。请求失败时可重新加载。不会执行目录中的安装命令字符串。仅 Git 源的条目仍可浏览和打开仓库链接，桌面安装只接受 npm 仓库包。无端口桌面 Host 不加载 `dshmarket` 的 Web 路由或独立包管理器。

<a id="remote-connections"></a>

## 远程连接

远程实例需要一个已安装 DSH 和 tmux 的 Linux SSH 账户。填写主机、SSH 端口、用户名、密码或私钥认证方式，以及 DSH 可执行文件路径。密码和私钥口令在连接时输入，仅保留在管理器进程中，不会写入注册表。配置保存私钥路径，不保存私钥内容。

首次连接需要确认服务器指纹。指纹变化时连接被阻止。管理器按主机和端口固定服务器密钥，修改信任记录前应核实变化原因。第一版使用明确的主机信息，不导入 SSH 配置别名或跳板机。

远端数据目录留空时使用 `~/.local/share/dsh-manager/instances/<id>` 下的独立目录，也可填写专用的绝对路径或 `~/` 路径。已存在但不包含本实例归属标记的目录会被拒绝。不要使用已有的个人 Harness home。

管理器在所属 tmux 会话中启动 `dsh --profile web --no-open --port 0`。通过 SSH 读取带认证信息的启动地址，并将本地回环端口转发到远端回环监听器。远端实例提供与其版本配套的 Web UI。认证 URL 不进入管理器日志或配置。

SSH 断开时显示远端进程状态未知。重连会先检查所属 tmux 会话，再决定是否启动进程。显式**停止实例**会核实目录和 tmux 归属后再停止该会话。启动失败时可检查远端实例目录中的 `.manager-startup.log`，该文件包含认证信息，不应分享。

<a id="lifecycle-and-storage"></a>

## 生命周期与存储

| 操作 | 本地实例 | 远程实例 |
|---|---|---|
| 关闭标签页 | 关闭视图，进程继续 | 断开 SSH，进程继续 |
| 断开连接 | 分离视图，进程继续 | 关闭隧道，进程状态变为未知 |
| 停止 | 停止所选 Host | 通过 SSH 停止所属 tmux 会话 |
| 退出管理器 | 确认后停止本地 Host | 断开连接，远端任务继续 |
| 移除配置 | 停止 Host，保留数据 | 忘记连接，保留远端进程和数据 |

注册表和标签页布局保存在 `$DSH_HOME/desktop/agent-manager/instances.json`，软件偏好和加密模型 Key 位于同目录的 `software-settings.json`。本地 home 位于 `$DSH_HOME/desktop/agent-manager/instances/<id>`，每个目录都有独立的保留 profile `profiles/desktop`。浏览器分区按实例 ID 隔离。恢复的标签页在选中时连接，退出应用后需要重新输入 SSH 凭据。

远程进程驻留涵盖管理器退出与 SSH 中断，不涵盖服务器重启或管理员强制清理会话。实例运行时不要删除其数据目录。

<a id="development-and-packaging"></a>

## 开发与打包

在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm run dev:desktop
```

仓库构建成功后，可通过 `pnpm run start:desktop` 跳过构建直接启动。开发数据保存在 `apps/desktop/.desktop-build/development/home`，外部插件安装需要打包应用。

真实 Electron 冒烟测试使用临时 home 启动两个本地 Host，验证共享偏好和测试凭据的继承，操作标签页与快捷键，最后停止两个进程：

```powershell
pnpm exec tsx apps/desktop/scripts/smoke-manager.ts
```

生成未签名 Windows 测试安装包：

```powershell
$env:DSH_DESKTOP_APP_ID = 'dev.dsh.agentmanager'
pnpm run package:desktop:win:x64:unsigned
```

安装包输出到 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts`。打包流程会构建并准备完整运行时，再调用 electron-builder。管理器已关闭官方自动更新和更新菜单。

<a id="implementation"></a>

## 实现

主进程拥有实例注册表、每实例运行时控制器和隔离的 `WebContentsView`。本地请求沿用现有分帧管道传输，并按浏览器分区绑定。SSH 实例使用 `ssh2`，其可选原生加速构建被禁用，采用标准 JavaScript 实现。

管理器与插件 IPC 要求调用方是所属的确切顶层渲染器。本地 Agent 页面仅收到传输标记，远端页面不注入管理器 preload。实例页面启用沙箱、关闭 Node 集成，不能导航到管理器文档。

生命周期归属与替代方案见[多实例决策](../../.agents/notes/implemented/architecture/2026-09-16-desktop-instance-manager.zh.md)。

<a id="known-limitations"></a>

## 已知限制

此版本不包含跨实例任务聚合、调度、自动部署 DSH、服务器重启恢复、密码持久化和 SSH 配置导入。依赖生命周期构建的远端插件需要在实例端另行准备。本地快照和远端副本代次会占用磁盘空间，不自动回收。部署待生效期间不要手动执行包变更。

自动检查覆盖通过 SSH 隧道发送认证 Web 请求、使用真实 pnpm 和测试仓库准备独立依赖、共享 Host 模块身份，以及中断启动后的恢复。它们不能替代在预装 DSH 的 Linux 服务端上使用真实第三方原生依赖和模型凭据开展的验收。

## 开发备注

未签名测试应用使用独立应用 ID，不连接官方发布更新器。
