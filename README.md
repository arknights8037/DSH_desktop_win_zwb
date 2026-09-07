# DeepSeek Harness Desktop

Windows x64 Electron wrapper for the official DeepSeek Harness Web UI.

## 插件管理

插件管理页会按职能将插件归入“智能体与自动化、开发与文件、数据与会话、网络与信息、界面与系统、其他”六类。可使用顶部下拉菜单筛选分类，也可在每张插件卡片中调整分类；手动分类会保存到应用数据目录，且不会改变插件的启用状态。

## 技能与扩展

侧栏顶部的“技能与扩展”页面使用切换控件分别管理 Skills 与 MCP。Skills 可添加本地目录，也可从 `owner/repository`、HTTPS Git、GitHub `tree` 子目录或直接 Markdown 地址导入；地址导入内容安装到 DSH 用户技能根并由已有的 `skill-filesystem` Provider 发现。本地附加目录和 stdio／Streamable HTTP MCP 配置保存到应用数据目录中的 `desktop-integrations.json`，并通过 Cordis patch 分别挂载到 `@deepseek-ai/dsh-skill-filesystem` 和 `@deepseek-ai/dsh-mcp-client`；重启后台后这些配置对新会话生效。当前页面不保存环境变量、HTTP 请求头或其他密钥；这类认证信息请由 MCP 进程或系统环境提供。

## Development

PowerShell:

```powershell
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:ALL_PROXY = 'http://127.0.0.1:7890'
pnpm install
pnpm run dev
```

## Build the installer

```powershell
pnpm run dist
```

The NSIS installer is written to `release/DeepSeek-Harness-Desktop-0.1.0-win-x64.exe`.
The packaged client includes the Harness runtime and a standalone Node.js
runtime, so it does not require Node.js on the target machine. The standalone
runtime is also used by Harness's Windows native directory picker. Build output
is Windows x64 and is unsigned.
