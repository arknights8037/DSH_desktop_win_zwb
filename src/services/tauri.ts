import { invoke } from "@tauri-apps/api/core";
import type {
  AiTaskResult,
  AiTask,
  Article,
  ArticleFilter,
  ArticleListItem,
  AgentMessage,
  Category,
  Feed,
  ProviderConfig,
  Tag,
  AgentSession,
} from "../types";

export function listFeeds() {
  return invoke<Feed[]>("list_feeds");
}

export function listCategories() {
  return invoke<Category[]>("list_categories");
}

export function listTags() {
  return invoke<Tag[]>("list_tags");
}

export function validateFeed(url: string) {
  return invoke<{ title: string; url: string; site_url?: string | null; description?: string | null; item_count: number }>("validate_feed", { url });
}

export function addFeed(url: string, categoryId: string | null, tagIds: string[]) {
  return invoke<void>("add_feed", { request: { url, category_id: categoryId, tag_ids: tagIds } });
}

export function deleteFeed(id: string) {
  return invoke<void>("delete_feed", { id });
}

export function syncFeeds(feedIds?: string[]) {
  return invoke<number>("sync_feeds", { feedIds: feedIds ?? null });
}

export function listArticles(filter: ArticleFilter) {
  return invoke<ArticleListItem[]>("list_articles", { filter });
}

export function listAgentMessages(sessionId: string) {
  return invoke<AgentMessage[]>("list_agent_messages", { sessionId });
}

export function getArticle(id: string) {
  return invoke<Article | null>("get_article", { id });
}

export function fetchArticleContent(id: string) {
  return invoke<Article>("fetch_article_content", { id });
}

export function updateArticleState(id: string, update: { isRead?: boolean; isStarred?: boolean }) {
  return invoke<void>("update_article_state", { id, update: { is_read: update.isRead, is_starred: update.isStarred } });
}

export function setFeedOrganization(feedId: string, categoryId: string | null, tagIds: string[]) {
  return invoke<void>("set_feed_organization", { feedId, update: { category_id: categoryId, tag_ids: tagIds } });
}

export function setArticleOrganization(articleId: string, categoryId: string | null, tagIds: string[]) {
  return invoke<void>("set_article_organization", { articleId, update: { category_id: categoryId, tag_ids: tagIds } });
}

export function createCategory(name: string, color = "#8b5cf6", icon = "◫") {
  return invoke<Category>("create_category", { name, color, icon });
}

export function updateCategory(id: string, name: string, color = "#8b5cf6", icon = "◫") {
  return invoke<Category>("update_category", { id, name, color, icon });
}

export function createTag(name: string, color = "#14b8a6") {
  return invoke<Tag>("create_tag", { name, color });
}

export function getProviderConfig() {
  return invoke<ProviderConfig | null>("get_provider_config");
}

export function saveProviderConfig(config: ProviderConfig, apiKey?: string) {
  return invoke<void>("save_provider_config", { config, apiKey: apiKey || null });
}

export function getAiApiKey(apiKeyRef: string) {
  return invoke<string>("get_ai_api_key", { apiKeyRef });
}

export function runAiTask(task: AiTask, articleIds: string[], targetLanguage = "简体中文") {
  return invoke<AiTaskResult>("run_ai_task", { request: { task, article_ids: articleIds, target_language: targetLanguage } });
}

export function startAgentSession() {
  return invoke<AgentSession>("start_agent_session");
}

export function saveAgentMessage(sessionId: string, role: string, content: string) {
  return invoke("send_agent_message", { sessionId, role, content });
}
