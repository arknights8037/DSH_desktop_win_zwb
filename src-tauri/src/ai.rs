use crate::db;
use crate::models::{AiProviderConfig, AiTaskRequest, AiTaskResult};
use chrono::Utc;
use keyring::Entry;
use reqwest::Client;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use uuid::Uuid;

pub fn save_key(reference: &str, value: &str) -> Result<(), String> {
    Entry::new("ai4rss", reference)
        .map_err(|error| error.to_string())?
        .set_password(value)
        .map_err(|error| error.to_string())
}

pub fn read_key(reference: &str) -> Result<String, String> {
    Entry::new("ai4rss", reference)
        .map_err(|error| error.to_string())?
        .get_password()
        .map_err(|error| error.to_string())
}

pub async fn run_task(
    pool: &SqlitePool,
    client: &Client,
    config: &AiProviderConfig,
    request: AiTaskRequest,
) -> Result<AiTaskResult, String> {
    if request.article_ids.is_empty() {
        return Err("至少选择一篇文章".to_string());
    }
    let api_key = read_key(&config.api_key_ref)?;
    let mut sources = Vec::new();
    for id in &request.article_ids {
        if let Some((title, url, body, _feed_id)) =
            db::article_for_ai(pool, id).await.map_err(internal)?
        {
            sources.push(format!("标题：{title}\n链接：{url}\n正文：{body}"));
        }
    }
    if sources.is_empty() {
        return Err("未找到可分析的文章".to_string());
    }
    let language = request.target_language.as_deref().unwrap_or("简体中文");
    let instruction = match request.task.as_str() {
        "translate" => format!("将下面的文章翻译为{language}，保留原意、段落结构和专有名词，不添加原文没有的事实。"),
        "summarize" => "请输出 JSON：{\"tl;dr\": string, \"keyPoints\": string[], \"entities\": string[]}。只根据文章内容总结。".to_string(),
        "credibility" => "请输出 JSON：{\"conclusion\": string, \"keyPoints\": string[], \"evidence\": [{\"articleId\": string, \"quote\": string}], \"confidence\": \"low|medium|high\", \"caveats\": string[]}。这是辅助判断，不等同于事实核查；只能根据给定文章与来源元数据分析。".to_string(),
        "cross-analysis" => "请输出 JSON：{\"conclusion\": string, \"keyPoints\": string[], \"agreements\": string[], \"disagreements\": string[], \"evidence\": [{\"articleId\": string, \"quote\": string}], \"confidence\": \"low|medium|high\", \"caveats\": string[]}。比较文章之间的共识、差异和证据，不要补充未提供的事实。".to_string(),
        other => return Err(format!("不支持的 AI 任务：{other}")),
    };
    let prompt = format!(
        "{instruction}\n\n文章资料：\n{}",
        sources.join("\n\n---\n\n")
    );
    let base_url = config.base_url.trim_end_matches('/');
    let endpoint = if base_url.ends_with("/responses") {
        base_url.to_string()
    } else {
        format!("{base_url}/responses")
    };
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .timeout(std::time::Duration::from_millis(
            config.timeout_ms.max(1_000),
        ))
        .json(&json!({
            "model": config.model,
            "input": [{ "role": "user", "content": prompt }],
            "store": false
        }))
        .send()
        .await
        .map_err(internal)?;
    let status = response.status();
    let body: Value = response.json().await.map_err(internal)?;
    if !status.is_success() {
        return Err(format!("Responses API 请求失败：HTTP {status} {}", body));
    }
    let content =
        extract_output_text(&body).ok_or_else(|| "Responses API 未返回文本输出".to_string())?;
    let created_at = Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO ai_results (id, task, article_ids, content, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(Uuid::new_v4().to_string())
        .bind(&request.task)
        .bind(serde_json::to_string(&request.article_ids).map_err(internal)?)
        .bind(&content)
        .bind(&created_at)
        .execute(pool)
        .await
        .map_err(internal)?;
    Ok(AiTaskResult {
        task: request.task,
        article_ids: request.article_ids,
        content,
        created_at,
    })
}

fn extract_output_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    let mut parts = Vec::new();
    if let Some(items) = value.get("output").and_then(Value::as_array) {
        for item in items {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                parts.push(text.to_string());
            }
            if let Some(content) = item.get("content").and_then(Value::as_array) {
                for block in content {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        parts.push(text.to_string());
                    }
                }
            }
        }
    }
    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> String {
    error.to_string()
}
