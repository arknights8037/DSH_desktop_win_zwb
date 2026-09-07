# AI4RSS

一个本地优先的 Tauri RSS 阅读器，使用 Vue 3 + TypeScript + Rust 构建。

## 已实现

- RSS、Atom、JSON Feed 添加与同步
- SQLite 本地持久化、ETag/Last-Modified、文章去重
- Feed、分类、标签、未读与收藏管理
- 正文抽取、HTML 清洗、原站回退
- 翻译、总结、可信度与跨文章分析
- OpenAI Responses API / OpenAI-compatible Provider
- 基于 Pi Agent Core 的本地阅读 Agent

## 开发

```powershell
pnpm install
pnpm tauri dev
```

## 验证

```powershell
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

生成的 Windows 安装包位于 `src-tauri/target/release/bundle/`。

AI 设置在应用内完成。API Key 通过 Windows Credential Manager 保存，不写入 SQLite 或前端存储。
