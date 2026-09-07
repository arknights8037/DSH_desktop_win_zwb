import type { ArticleListItem } from "../../types";
import type { AgentOutputArticle, AgentToolRecord, AgentTurnResult, OutputAdapter } from "../contracts";

function isArticle(value: unknown): value is ArticleListItem {
  if (!value || typeof value !== "object") return false;
  const article = value as Partial<ArticleListItem>;
  return typeof article.id === "string" && typeof article.title === "string" && typeof article.url === "string" && typeof article.feed_title === "string";
}

function articlesFromRecord(record: AgentToolRecord) {
  if (Array.isArray(record.result.data)) return record.result.data.filter(isArticle);
  return isArticle(record.result.data) ? [record.result.data] : [];
}

export const articleDigestOutputAdapter: OutputAdapter = {
  id: "article-digest",
  canHandle(result: AgentTurnResult) {
    return result.toolResults.some((record) => articlesFromRecord(record).length > 0);
  },
  adapt(result: AgentTurnResult) {
    const seen = new Set<string>();
    const articles: AgentOutputArticle[] = [];
    for (const record of result.toolResults) {
      for (const article of articlesFromRecord(record)) {
        if (seen.has(article.id)) continue;
        seen.add(article.id);
        articles.push({
          id: article.id,
          title: article.title,
          source: article.feed_title,
          url: article.url,
          summary: article.summary,
          publishedAt: article.published_at,
        });
      }
    }
    return [
      { type: "text", text: result.assistantText || "已找到相关本地文章。" },
      ...articles.map((article) => ({ type: "article" as const, article })),
    ];
  },
};
