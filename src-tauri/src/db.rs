use crate::models::AgentMessage;
use crate::models::{Article, ArticleFilter, ArticleListItem, Category, Feed, Tag};
use sqlx::{Row, SqlitePool};

pub async fn init(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let statements = [
        "PRAGMA foreign_keys = ON",
        "CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, icon TEXT NOT NULL DEFAULT '◫', color TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, site_url TEXT, description TEXT, category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, etag TEXT, last_modified TEXT, last_synced_at TEXT)",
        "CREATE TABLE IF NOT EXISTS feed_tags (feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(feed_id, tag_id))",
        "CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE, category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, guid_hash TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, author TEXT, published_at TEXT, summary_html TEXT, content_html TEXT, content_text TEXT, is_read INTEGER NOT NULL DEFAULT 0, is_starred INTEGER NOT NULL DEFAULT 0, read_at TEXT, fetched_at TEXT, UNIQUE(feed_id, guid_hash))",
        "CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id)",
        "CREATE TABLE IF NOT EXISTS article_tags (article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(article_id, tag_id))",
        "CREATE TABLE IF NOT EXISTS ai_results (id TEXT PRIMARY KEY, task TEXT NOT NULL, article_ids TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS agent_sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    ];

    for statement in statements {
        sqlx::query(statement).execute(pool).await?;
    }

    // Add article-level categories for databases created by the first build.
    let _ = sqlx::query("ALTER TABLE articles ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL")
        .execute(pool)
        .await;
    let _ = sqlx::query("ALTER TABLE categories ADD COLUMN icon TEXT NOT NULL DEFAULT '◫'")
        .execute(pool)
        .await;

    // Migrate articles saved by earlier builds: RSSHub commonly exposes the
    // full article as <description>, which is stored in summary_html.
    sqlx::query(
        "UPDATE articles SET content_html = summary_html
         WHERE (content_html IS NULL OR trim(content_html) = '')
           AND summary_html IS NOT NULL AND trim(summary_html) <> ''",
    )
    .execute(pool)
    .await?;

    sqlx::query("INSERT OR IGNORE INTO categories (id, name, icon, color, sort_order) VALUES ('inbox', '收件箱', '⌂', '#8b5cf6', 0)")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_feeds(pool: &SqlitePool) -> Result<Vec<Feed>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT f.id, f.url, f.title, f.site_url, f.description, f.category_id, f.last_synced_at,
                (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.is_read = 0) AS unread_count
         FROM feeds f ORDER BY f.title COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;

    let mut feeds = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.get("id");
        feeds.push(Feed {
            tag_ids: feed_tag_ids(pool, &id).await?,
            id,
            url: row.get("url"),
            title: row.get("title"),
            site_url: row.get("site_url"),
            description: row.get("description"),
            category_id: row.get("category_id"),
            last_synced_at: row.get("last_synced_at"),
            unread_count: row.get("unread_count"),
        });
    }
    Ok(feeds)
}

pub async fn list_categories(pool: &SqlitePool) -> Result<Vec<Category>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, name, icon, color, sort_order FROM categories ORDER BY sort_order, name",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Category {
            id: row.get("id"),
            name: row.get("name"),
            icon: row.get("icon"),
            color: row.get("color"),
            sort_order: row.get("sort_order"),
        })
        .collect())
}

pub async fn list_tags(pool: &SqlitePool) -> Result<Vec<Tag>, sqlx::Error> {
    let rows = sqlx::query("SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| Tag {
            id: row.get("id"),
            name: row.get("name"),
            color: row.get("color"),
        })
        .collect())
}

pub async fn list_articles(
    pool: &SqlitePool,
    filter: ArticleFilter,
) -> Result<Vec<ArticleListItem>, sqlx::Error> {
    let mut sql = String::from(
        "SELECT a.id, a.feed_id, COALESCE(a.category_id, f.category_id) AS category_id, f.title AS feed_title, a.title, a.url, a.author, a.published_at,
                a.summary_html, a.is_read, a.is_starred
         FROM articles a JOIN feeds f ON f.id = a.feed_id",
    );
    let mut conditions = Vec::new();
    if filter.tag_id.is_some() {
        sql.push_str(" JOIN article_tags at ON at.article_id = a.id");
    }
    if filter.feed_id.is_some() {
        conditions.push("a.feed_id = ?".to_string());
    }
    if filter.category_id.is_some() {
        conditions.push("COALESCE(a.category_id, f.category_id) = ?".to_string());
    }
    if filter.tag_id.is_some() {
        conditions.push("at.tag_id = ?".to_string());
    }
    if filter.unread_only {
        conditions.push("a.is_read = 0".to_string());
    }
    if filter.starred_only {
        conditions.push("a.is_starred = 1".to_string());
    }
    if filter.query.is_some() {
        conditions.push("(a.title LIKE ? OR a.summary_html LIKE ?)".to_string());
    }
    if filter.published_from.is_some() {
        conditions.push("COALESCE(a.published_at, a.fetched_at) >= ?".to_string());
    }
    if filter.published_to.is_some() {
        conditions.push("COALESCE(a.published_at, a.fetched_at) <= ?".to_string());
    }
    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }
    sql.push_str(" ORDER BY COALESCE(a.published_at, a.fetched_at) DESC LIMIT ?");

    let mut query = sqlx::query(&sql);
    if let Some(feed_id) = filter.feed_id {
        query = query.bind(feed_id);
    }
    if let Some(category_id) = filter.category_id {
        query = query.bind(category_id);
    }
    if let Some(tag_id) = filter.tag_id {
        query = query.bind(tag_id);
    }
    if let Some(search) = filter.query {
        let search = format!("%{}%", search);
        query = query.bind(search.clone()).bind(search);
    }
    if let Some(published_from) = filter.published_from {
        query = query.bind(published_from);
    }
    if let Some(published_to) = filter.published_to {
        query = query.bind(published_to);
    }
    query = query.bind(filter.limit.unwrap_or(100).clamp(1, 500));

    let rows = query.fetch_all(pool).await?;
    let mut articles = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.get("id");
        articles.push(ArticleListItem {
            tags: article_tags(pool, &id).await?,
            id,
            feed_id: row.get("feed_id"),
            category_id: row.get("category_id"),
            feed_title: row.get("feed_title"),
            title: row.get("title"),
            url: row.get("url"),
            author: row.get("author"),
            published_at: row.get("published_at"),
            summary: row.get("summary_html"),
            is_read: row.get::<i64, _>("is_read") != 0,
            is_starred: row.get::<i64, _>("is_starred") != 0,
        });
    }
    Ok(articles)
}

pub async fn list_agent_messages(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<AgentMessage>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, session_id, role, content, created_at
         FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AgentMessage {
            id: row.get("id"),
            session_id: row.get("session_id"),
            role: row.get("role"),
            content: row.get("content"),
            created_at: row.get("created_at"),
        })
        .collect())
}

pub async fn get_article(pool: &SqlitePool, id: &str) -> Result<Option<Article>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT a.id, a.feed_id, COALESCE(a.category_id, f.category_id) AS category_id, f.title AS feed_title, a.title, a.url, a.author, a.published_at,
                a.summary_html, a.content_html, a.content_text, a.is_read, a.is_starred
         FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE a.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| Article {
        id: row.get("id"),
        feed_id: row.get("feed_id"),
        category_id: row.get("category_id"),
        feed_title: row.get("feed_title"),
        title: row.get("title"),
        url: row.get("url"),
        author: row.get("author"),
        published_at: row.get("published_at"),
        summary_html: row.get("summary_html"),
        content_html: row.get("content_html"),
        content_text: row.get("content_text"),
        is_read: row.get::<i64, _>("is_read") != 0,
        is_starred: row.get::<i64, _>("is_starred") != 0,
        tags: Vec::new(),
    }))
}

pub async fn article_tags(pool: &SqlitePool, article_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT t.name FROM tags t JOIN article_tags at ON at.tag_id = t.id WHERE at.article_id = ? ORDER BY t.name",
    )
    .bind(article_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|row| row.get("name")).collect())
}

pub async fn feed_tag_ids(pool: &SqlitePool, feed_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query("SELECT tag_id FROM feed_tags WHERE feed_id = ? ORDER BY tag_id")
        .bind(feed_id)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|row| row.get("tag_id")).collect())
}

pub async fn article_for_ai(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<(String, String, String, String)>, sqlx::Error> {
    let row = sqlx::query("SELECT title, url, COALESCE(content_text, summary_html, '') AS body, feed_id FROM articles WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|row| {
        (
            row.get("title"),
            row.get("url"),
            row.get("body"),
            row.get("feed_id"),
        )
    }))
}
