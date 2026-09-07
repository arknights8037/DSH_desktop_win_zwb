mod ai;
mod db;
mod models;
mod rss;

use chrono::Utc;
use models::{
    AddFeedRequest, AgentMessage, AgentSession, AiProviderConfig, AiTaskRequest, AiTaskResult,
    Article, ArticleFilter, ArticleListItem, ArticleStateUpdate, Category, Feed, FeedPreview,
    OrganizationUpdate, Tag,
};
use reqwest::Client;
use sqlx::{sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions, SqlitePool};
use std::{path::PathBuf, str::FromStr, sync::Mutex};
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

pub struct AppState {
    pub pool: SqlitePool,
    pub http: Client,
    pub provider: Mutex<Option<AiProviderConfig>>,
}

#[tauri::command]
async fn list_feeds(state: State<'_, AppState>) -> Result<Vec<Feed>, String> {
    db::list_feeds(&state.pool).await.map_err(internal)
}

#[tauri::command]
async fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    db::list_categories(&state.pool).await.map_err(internal)
}

#[tauri::command]
async fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    db::list_tags(&state.pool).await.map_err(internal)
}

#[tauri::command]
async fn create_category(
    name: String,
    color: String,
    icon: String,
    state: State<'_, AppState>,
) -> Result<Category, String> {
    let icon = icon.trim().chars().take(2).collect::<String>();
    let category = Category {
        id: Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        icon: if icon.is_empty() {
            "◫".to_string()
        } else {
            icon
        },
        color,
        sort_order: 10,
    };
    if category.name.is_empty() {
        return Err("分类名称不能为空".to_string());
    }
    sqlx::query(
        "INSERT INTO categories (id, name, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&category.id)
    .bind(&category.name)
    .bind(&category.icon)
    .bind(&category.color)
    .bind(category.sort_order)
    .execute(&state.pool)
    .await
    .map_err(internal)?;
    Ok(category)
}

#[tauri::command]
async fn update_category(
    id: String,
    name: String,
    color: String,
    icon: String,
    state: State<'_, AppState>,
) -> Result<Category, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("分类名称不能为空".to_string());
    }
    let icon = icon.trim().chars().take(2).collect::<String>();
    let icon = if icon.is_empty() {
        "◫".to_string()
    } else {
        icon
    };
    sqlx::query("UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?")
        .bind(&name)
        .bind(&icon)
        .bind(&color)
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    sqlx::query_as::<_, (String, String, String, String, i64)>(
        "SELECT id, name, icon, color, sort_order FROM categories WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?
    .map(|(id, name, icon, color, sort_order)| Category {
        id,
        name,
        icon,
        color,
        sort_order,
    })
    .ok_or_else(|| "分类不存在".to_string())
}

#[tauri::command]
async fn create_tag(
    name: String,
    color: String,
    state: State<'_, AppState>,
) -> Result<Tag, String> {
    let tag = Tag {
        id: Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        color,
    };
    if tag.name.is_empty() {
        return Err("标签名称不能为空".to_string());
    }
    sqlx::query("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)")
        .bind(&tag.id)
        .bind(&tag.name)
        .bind(&tag.color)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    Ok(tag)
}

#[tauri::command]
async fn validate_feed(url: String, state: State<'_, AppState>) -> Result<FeedPreview, String> {
    rss::validate_feed(&state.http, &url).await
}

#[tauri::command]
async fn add_feed(request: AddFeedRequest, state: State<'_, AppState>) -> Result<(), String> {
    rss::add_feed(&state.pool, &state.http, request).await
}

#[tauri::command]
async fn delete_feed(id: String, state: State<'_, AppState>) -> Result<(), String> {
    sqlx::query("DELETE FROM feeds WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    Ok(())
}

#[tauri::command]
async fn sync_feeds(
    feed_ids: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    rss::sync_feeds(&state.pool, &state.http, feed_ids).await
}

#[tauri::command]
async fn list_articles(
    filter: ArticleFilter,
    state: State<'_, AppState>,
) -> Result<Vec<ArticleListItem>, String> {
    db::list_articles(&state.pool, filter)
        .await
        .map_err(internal)
}

#[tauri::command]
async fn get_article(id: String, state: State<'_, AppState>) -> Result<Option<Article>, String> {
    let mut article = db::get_article(&state.pool, &id).await.map_err(internal)?;
    if let Some(value) = article.as_mut() {
        value.tags = db::article_tags(&state.pool, &id).await.map_err(internal)?;
    }
    Ok(article)
}

#[tauri::command]
async fn fetch_article_content(id: String, state: State<'_, AppState>) -> Result<Article, String> {
    let mut article = rss::fetch_article_content(&state.pool, &state.http, &id).await?;
    article.tags = db::article_tags(&state.pool, &id).await.map_err(internal)?;
    Ok(article)
}

#[tauri::command]
async fn update_article_state(
    id: String,
    update: ArticleStateUpdate,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(value) = update.is_read {
        sqlx::query("UPDATE articles SET is_read = ?, read_at = CASE WHEN ? = 1 THEN ? ELSE NULL END WHERE id = ?")
            .bind(value as i64)
            .bind(value as i64)
            .bind(Utc::now().to_rfc3339())
            .bind(&id)
            .execute(&state.pool)
            .await
            .map_err(internal)?;
    }
    if let Some(value) = update.is_starred {
        sqlx::query("UPDATE articles SET is_starred = ? WHERE id = ?")
            .bind(value as i64)
            .bind(id)
            .execute(&state.pool)
            .await
            .map_err(internal)?;
    }
    Ok(())
}

#[tauri::command]
async fn set_feed_organization(
    feed_id: String,
    update: OrganizationUpdate,
    state: State<'_, AppState>,
) -> Result<(), String> {
    sqlx::query("UPDATE feeds SET category_id = ? WHERE id = ?")
        .bind(update.category_id)
        .bind(&feed_id)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    sqlx::query("DELETE FROM feed_tags WHERE feed_id = ?")
        .bind(&feed_id)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    for tag_id in update.tag_ids {
        sqlx::query("INSERT OR IGNORE INTO feed_tags (feed_id, tag_id) VALUES (?, ?)")
            .bind(&feed_id)
            .bind(tag_id)
            .execute(&state.pool)
            .await
            .map_err(internal)?;
    }
    Ok(())
}

#[tauri::command]
async fn set_article_organization(
    article_id: String,
    update: OrganizationUpdate,
    state: State<'_, AppState>,
) -> Result<(), String> {
    sqlx::query("UPDATE articles SET category_id = ? WHERE id = ?")
        .bind(update.category_id)
        .bind(&article_id)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    sqlx::query("DELETE FROM article_tags WHERE article_id = ?")
        .bind(&article_id)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    for tag_id in update.tag_ids {
        sqlx::query("INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)")
            .bind(&article_id)
            .bind(tag_id)
            .execute(&state.pool)
            .await
            .map_err(internal)?;
    }
    Ok(())
}

#[tauri::command]
async fn save_provider_config(
    config: AiProviderConfig,
    api_key: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if config.base_url.trim().is_empty() || config.model.trim().is_empty() {
        return Err("Base URL 和模型不能为空".to_string());
    }
    if let Some(key) = api_key.filter(|value| !value.trim().is_empty()) {
        ai::save_key(&config.api_key_ref, &key)?;
    }
    let serialized = serde_json::to_string(&config).map_err(internal)?;
    sqlx::query("INSERT INTO app_settings (key, value) VALUES ('ai_provider', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(serialized)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    *state
        .provider
        .lock()
        .map_err(|_| "Provider 状态锁失败".to_string())? = Some(config);
    Ok(())
}

#[tauri::command]
async fn get_provider_config(
    state: State<'_, AppState>,
) -> Result<Option<AiProviderConfig>, String> {
    Ok(state
        .provider
        .lock()
        .map_err(|_| "Provider 状态锁失败".to_string())?
        .clone())
}

#[tauri::command]
async fn get_ai_api_key(api_key_ref: String) -> Result<String, String> {
    ai::read_key(&api_key_ref)
}

#[tauri::command]
async fn run_ai_task(
    request: AiTaskRequest,
    state: State<'_, AppState>,
) -> Result<AiTaskResult, String> {
    let config = state
        .provider
        .lock()
        .map_err(|_| "Provider 状态锁失败".to_string())?
        .clone()
        .ok_or_else(|| "请先在设置中配置 AI Provider".to_string())?;
    ai::run_task(&state.pool, &state.http, &config, request).await
}

#[tauri::command]
async fn start_agent_session(state: State<'_, AppState>) -> Result<AgentSession, String> {
    let session = AgentSession {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    sqlx::query("INSERT INTO agent_sessions (id, created_at) VALUES (?, ?)")
        .bind(&session.id)
        .bind(&session.created_at)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    Ok(session)
}

#[tauri::command]
async fn list_agent_messages(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AgentMessage>, String> {
    db::list_agent_messages(&state.pool, &session_id)
        .await
        .map_err(internal)
}

#[tauri::command]
async fn send_agent_message(
    session_id: String,
    role: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<AgentMessage, String> {
    let message = AgentMessage {
        id: Uuid::new_v4().to_string(),
        session_id,
        role,
        content,
        created_at: Utc::now().to_rfc3339(),
    };
    sqlx::query("INSERT INTO agent_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(&message.id)
        .bind(&message.session_id)
        .bind(&message.role)
        .bind(&message.content)
        .bind(&message.created_at)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    Ok(message)
}

#[tauri::command]
fn cancel_agent_run(_run_id: String) -> bool {
    true
}

#[tauri::command]
fn window_start_dragging(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(internal)
}

#[tauri::command]
fn window_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(internal)
}

#[tauri::command]
fn window_toggle_maximize(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(internal)? {
        window.unmaximize().map_err(internal)
    } else {
        window.maximize().map_err(internal)
    }
}

#[tauri::command]
fn window_close(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(internal)
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> String {
    error.to_string()
}

async fn load_provider(pool: &SqlitePool) -> Option<AiProviderConfig> {
    let value =
        sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key = 'ai_provider'")
            .fetch_optional(pool)
            .await
            .ok()??;
    serde_json::from_str(&value).ok()
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("ai4rss.db"))
        .map_err(internal)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let path = database_path(app.handle())?;
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let options = SqliteConnectOptions::from_str(path.to_string_lossy().as_ref())
                .map_err(|error| error.to_string())?
                .create_if_missing(true);
            let pool = tauri::async_runtime::block_on(async {
                let pool = SqlitePoolOptions::new()
                    .max_connections(5)
                    .connect_with(options)
                    .await
                    .map_err(internal)?;
                db::init(&pool).await.map_err(internal)?;
                Ok::<SqlitePool, String>(pool)
            })?;
            let provider = tauri::async_runtime::block_on(load_provider(&pool));
            let http = Client::builder()
                .user_agent("AI4RSS/0.1 (+https://localhost)")
                .build()
                .map_err(internal)?;
            app.manage(AppState {
                pool,
                http,
                provider: Mutex::new(provider),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_feeds,
            list_categories,
            list_tags,
            create_category,
            update_category,
            create_tag,
            validate_feed,
            add_feed,
            delete_feed,
            sync_feeds,
            list_articles,
            get_article,
            fetch_article_content,
            update_article_state,
            set_feed_organization,
            set_article_organization,
            save_provider_config,
            get_provider_config,
            get_ai_api_key,
            run_ai_task,
            start_agent_session,
            list_agent_messages,
            send_agent_message,
            cancel_agent_run,
            window_start_dragging,
            window_minimize,
            window_toggle_maximize,
            window_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running application");
}
