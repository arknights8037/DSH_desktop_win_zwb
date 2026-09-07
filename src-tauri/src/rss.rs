use crate::db;
use crate::models::{AddFeedRequest, FeedPreview};
use ammonia::{Builder, UrlRelative};
use chrono::Utc;
use feed_rs::model::Entry;
use feed_rs::parser;
use reqwest::{header, Client, StatusCode};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::error::Error;
use uuid::Uuid;

pub async fn validate_feed(client: &Client, url: &str) -> Result<FeedPreview, String> {
    let (feed, _) = fetch_feed(client, url, None, None).await?;
    let feed = feed.ok_or_else(|| "Feed 未返回内容".to_string())?;
    Ok(FeedPreview {
        title: feed
            .title
            .map(|title| title.content)
            .unwrap_or_else(|| url.to_string()),
        url: url.to_string(),
        site_url: feed.links.first().map(|link| link.href.clone()),
        description: feed.description.map(|description| description.content),
        item_count: feed.entries.len(),
    })
}

pub async fn add_feed(
    pool: &SqlitePool,
    client: &Client,
    request: AddFeedRequest,
) -> Result<(), String> {
    let url = normalize_url(&request.url)?;
    let (feed, response_meta) = fetch_feed(client, &url, None, None).await?;
    let feed = feed.ok_or_else(|| "Feed 未返回内容".to_string())?;
    let feed_id = sqlx::query_scalar::<_, String>("SELECT id FROM feeds WHERE url = ?")
        .bind(&url)
        .fetch_optional(pool)
        .await
        .map_err(internal)?
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let title = feed
        .title
        .map(|value| value.content)
        .unwrap_or_else(|| url.clone());
    let site_url = feed.links.first().map(|link| link.href.clone());
    let description = feed.description.map(|value| value.content);
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO feeds (id, url, title, site_url, description, category_id, etag, last_modified, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET title=excluded.title, site_url=excluded.site_url, description=excluded.description,
         category_id=COALESCE(excluded.category_id, feeds.category_id), etag=excluded.etag, last_modified=excluded.last_modified,
         last_synced_at=excluded.last_synced_at",
    )
    .bind(&feed_id)
    .bind(&url)
    .bind(title)
    .bind(site_url)
    .bind(description)
    .bind(request.category_id)
    .bind(response_meta.etag)
    .bind(response_meta.last_modified)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(internal)?;

    for tag_id in request.tag_ids {
        sqlx::query("INSERT OR IGNORE INTO feed_tags (feed_id, tag_id) VALUES (?, ?)")
            .bind(&feed_id)
            .bind(tag_id)
            .execute(pool)
            .await
            .map_err(internal)?;
    }
    insert_entries(pool, &feed_id, feed.entries).await
}

pub async fn sync_feeds(
    pool: &SqlitePool,
    client: &Client,
    ids: Option<Vec<String>>,
) -> Result<usize, String> {
    let feeds = if let Some(ids) = ids {
        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let query = format!(
            "SELECT id, url, etag, last_modified FROM feeds WHERE id IN ({})",
            placeholders
        );
        let mut request = sqlx::query(&query);
        for id in ids {
            request = request.bind(id);
        }
        request.fetch_all(pool).await.map_err(internal)?
    } else {
        sqlx::query("SELECT id, url, etag, last_modified FROM feeds")
            .fetch_all(pool)
            .await
            .map_err(internal)?
    };

    let mut inserted = 0;
    for row in feeds {
        let feed_id: String = row.try_get("id").map_err(internal)?;
        let url: String = row.try_get("url").map_err(internal)?;
        let etag: Option<String> = row.try_get("etag").map_err(internal)?;
        let last_modified: Option<String> = row.try_get("last_modified").map_err(internal)?;
        let (feed, meta) =
            fetch_feed(client, &url, etag.as_deref(), last_modified.as_deref()).await?;
        if meta.not_modified {
            continue;
        }
        let feed = feed.ok_or_else(|| "Feed 未返回内容".to_string())?;
        inserted += feed.entries.len();
        insert_entries(pool, &feed_id, feed.entries).await?;
        sqlx::query(
            "UPDATE feeds SET etag = ?, last_modified = ?, last_synced_at = ? WHERE id = ?",
        )
        .bind(meta.etag)
        .bind(meta.last_modified)
        .bind(Utc::now().to_rfc3339())
        .bind(feed_id)
        .execute(pool)
        .await
        .map_err(internal)?;
    }
    Ok(inserted)
}

pub async fn fetch_article_content(
    pool: &SqlitePool,
    client: &Client,
    article_id: &str,
) -> Result<crate::models::Article, String> {
    let article = db::get_article(pool, article_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| "文章不存在".to_string())?;
    if article
        .content_html
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return Ok(article);
    }
    // RSSHub and many RSS sources put the full article in <description>
    // rather than content:encoded. Promote that field to the reader body
    // before attempting a potentially blocked origin-page request.
    if let Some(summary) = article
        .summary_html
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let safe_summary = sanitize_html(summary, &article.url);
        let text = html_to_text(&safe_summary);
        sqlx::query(
            "UPDATE articles SET content_html = ?, content_text = ?, fetched_at = ? WHERE id = ?",
        )
        .bind(&safe_summary)
        .bind(&text)
        .bind(Utc::now().to_rfc3339())
        .bind(article_id)
        .execute(pool)
        .await
        .map_err(internal)?;
        return db::get_article(pool, article_id)
            .await
            .map_err(internal)?
            .ok_or_else(|| "文章更新失败".to_string());
    }
    let response = client.get(&article.url).send().await.map_err(internal)?;
    if !response.status().is_success() {
        return Err(format!("原文请求失败：HTTP {}", response.status()));
    }
    let html = response.text().await.map_err(internal)?;
    let extracted = legible::parse(&html, Some(&article.url), None).map_err(internal)?;
    let safe_html = sanitize_html(&extracted.content, &article.url);
    let text = html_to_text(&safe_html);
    sqlx::query(
        "UPDATE articles SET content_html = ?, content_text = ?, fetched_at = ? WHERE id = ?",
    )
    .bind(&safe_html)
    .bind(&text)
    .bind(Utc::now().to_rfc3339())
    .bind(article_id)
    .execute(pool)
    .await
    .map_err(internal)?;
    db::get_article(pool, article_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| "文章更新失败".to_string())
}

async fn insert_entries(
    pool: &SqlitePool,
    feed_id: &str,
    entries: Vec<Entry>,
) -> Result<(), String> {
    for entry in entries {
        let url = entry
            .links
            .first()
            .map(|link| link.href.clone())
            .unwrap_or_else(|| entry.id.clone());
        let guid_hash = hash_key(&format!("{}:{}", entry.id, url));
        let article_id = Uuid::new_v4().to_string();
        let summary = entry
            .summary
            .as_ref()
            .map(|value| sanitize_html(&value.content, &url));
        let content = entry
            .content
            .as_ref()
            .and_then(|value| value.body.as_ref())
            .map(|value| sanitize_html(value, &url));
        let reader_content = content.clone().or_else(|| summary.clone());
        let content_text = reader_content.as_deref().map(html_to_text);
        let author = entry.authors.first().map(|person| person.name.clone());
        let published_at = entry
            .published
            .or(entry.updated)
            .map(|date| date.to_rfc3339());
        sqlx::query(
            "INSERT INTO articles (id, feed_id, guid_hash, title, url, author, published_at, summary_html, content_html, content_text, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(feed_id, guid_hash) DO UPDATE SET title=excluded.title, url=excluded.url, author=excluded.author,
             published_at=excluded.published_at, summary_html=excluded.summary_html,
             content_html=COALESCE(articles.content_html, excluded.content_html), content_text=COALESCE(articles.content_text, excluded.content_text)",
        )
        .bind(article_id)
        .bind(feed_id)
        .bind(guid_hash)
        .bind(entry.title.map(|value| value.content).unwrap_or_else(|| "无标题".to_string()))
        .bind(url)
        .bind(author)
        .bind(published_at)
        .bind(summary)
        .bind(reader_content)
        .bind(content_text)
        .bind(Utc::now().to_rfc3339())
        .execute(pool)
        .await
        .map_err(internal)?;
    }
    Ok(())
}

struct ResponseMeta {
    etag: Option<String>,
    last_modified: Option<String>,
    not_modified: bool,
}

async fn fetch_feed(
    client: &Client,
    url: &str,
    etag: Option<&str>,
    last_modified: Option<&str>,
) -> Result<(Option<feed_rs::model::Feed>, ResponseMeta), String> {
    let mut request = client.get(url);
    if let Some(value) = etag {
        request = request.header(header::IF_NONE_MATCH, value);
    }
    if let Some(value) = last_modified {
        request = request.header(header::IF_MODIFIED_SINCE, value);
    }
    let response = request.send().await.map_err(internal)?;
    let meta = ResponseMeta {
        etag: response
            .headers()
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string),
        last_modified: response
            .headers()
            .get(header::LAST_MODIFIED)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string),
        not_modified: response.status() == StatusCode::NOT_MODIFIED,
    };
    if meta.not_modified {
        return Ok((None, meta));
    }
    if !response.status().is_success() {
        return Err(format!("Feed 请求失败：HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(internal)?;
    let feed = parser::parse(&bytes[..]).map_err(internal)?;
    Ok((Some(feed), meta))
}

fn normalize_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    if !(value.starts_with("http://") || value.starts_with("https://")) {
        return Err("订阅地址必须以 http:// 或 https:// 开头".to_string());
    }
    Ok(value.to_string())
}

fn hash_key(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn html_to_text(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Resolve relative URLs before the sanitized HTML is rendered inside the
/// Tauri app. Otherwise the WebView resolves them against the app origin.
fn sanitize_html(value: &str, base_url: &str) -> String {
    let mut builder = Builder::default();
    builder.add_tag_attributes(
            "img",
            [
                "srcset",
                "data-src",
                "data-original",
                "data-lazy-src",
                "data-original-src",
                "data-url",
                "data-srcset",
            ],
    );
    if let Ok(base) = reqwest::Url::parse(base_url) {
        builder.url_relative(UrlRelative::RewriteWithBase(base));
    }
    builder.clean(value).to_string()
}

fn internal(error: impl Error + Send + Sync + 'static) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rss_fixture() {
        let xml = br#"<rss version="2.0"><channel><title>Demo</title><link>https://example.com</link><item><guid>1</guid><title>Hello</title><link>https://example.com/1</link><description><![CDATA[<p>World</p>]]></description></item></channel></rss>"#;
        let feed = parser::parse(&xml[..]).expect("feed should parse");
        assert_eq!(feed.title.expect("title").content, "Demo");
        assert_eq!(feed.entries.len(), 1);
        assert_eq!(
            feed.entries[0].title.as_ref().expect("entry title").content,
            "Hello"
        );
    }

    #[test]
    fn strips_tags_and_collapses_whitespace() {
        assert_eq!(
            html_to_text("<p>Hello <b>RSS</b></p><p>Reader</p>"),
            "Hello RSS Reader"
        );
    }

    #[test]
    fn rejects_non_http_feed_urls() {
        assert!(normalize_url("ftp://example.com/feed.xml").is_err());
        assert_eq!(
            normalize_url(" https://example.com/feed.xml ").expect("valid url"),
            "https://example.com/feed.xml"
        );
    }

    #[test]
    fn rewrites_relative_image_sources_for_the_reader_origin() {
        let html = sanitize_html(
            r#"<p><img src="/images/cover.jpg" data-src="lazy.jpg" srcset="small.jpg 480w"></p>"#,
            "https://example.com/posts/one",
        );
        assert!(html.contains("src=\"https://example.com/images/cover.jpg\""));
        assert!(html.contains("data-src=\"lazy.jpg\""));
        assert!(html.contains("srcset=\"small.jpg 480w\""));
    }
}
