import { Type, type Static } from "typebox";
import type { Article, ArticleFilter, ArticleListItem } from "../../types";
import type { AgentToolDefinition, AgentToolContext, ToolCitation } from "../contracts";

const searchSchema = Type.Object({
  query: Type.Optional(Type.String()),
  feedId: Type.Optional(Type.String()),
  categoryId: Type.Optional(Type.String()),
  tagId: Type.Optional(Type.String()),
  publishedFrom: Type.Optional(Type.String()),
  publishedTo: Type.Optional(Type.String()),
  unreadOnly: Type.Optional(Type.Boolean()),
  starredOnly: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

type SearchParams = Static<typeof searchSchema>;

function assertNotAborted(context: AgentToolContext) {
  if (context.signal?.aborted) throw new Error("工具执行已取消");
}

function articleCitation(article: ArticleListItem | Article): ToolCitation {
  return {
    articleId: article.id,
    title: article.title,
    url: article.url,
    source: article.feed_title,
  };
}

function articleForModel(article: ArticleListItem | Article) {
  return {
    id: article.id,
    title: article.title,
    source: article.feed_title,
    url: article.url,
    publishedAt: article.published_at,
    summary: article.summary,
  };
}

export const searchArticlesTool: AgentToolDefinition<typeof searchSchema, ArticleListItem[]> = {
  id: "rss.search_articles",
  label: "搜索文章",
  description: "在本地 RSS 文章中按关键词、来源、分类、标签、时间范围和阅读状态搜索。",
  permission: "read",
  schema: searchSchema,
  async execute(context, params: SearchParams) {
    assertNotAborted(context);
    const filter: ArticleFilter = {
      feed_id: params.feedId ?? null,
      category_id: params.categoryId ?? null,
      tag_id: params.tagId ?? null,
      query: params.query?.trim() || null,
      published_from: params.publishedFrom ?? null,
      published_to: params.publishedTo ?? null,
      unread_only: params.unreadOnly ?? false,
      starred_only: params.starredOnly ?? false,
      limit: params.limit ?? 20,
    };
    const articles = await context.services.articles.search(filter);
    assertNotAborted(context);
    const citations = articles.map(articleCitation);
    return {
      data: articles,
      citations,
      modelText: articles.length
        ? JSON.stringify(articles.map(articleForModel))
        : "没有找到符合条件的本地文章。",
      meta: { count: articles.length, filter },
    };
  },
};

const articleIdSchema = Type.Object({ id: Type.String({ minLength: 1 }) });
type ArticleIdParams = Static<typeof articleIdSchema>;

export const getArticleTool: AgentToolDefinition<typeof articleIdSchema, Article | null> = {
  id: "rss.get_article",
  label: "读取文章",
  description: "读取本地 RSS 文章的完整标题、正文、摘要、来源和链接。",
  permission: "read",
  schema: articleIdSchema,
  async execute(context, params: ArticleIdParams) {
    assertNotAborted(context);
    const article = await context.services.articles.get(params.id);
    if (!article) {
      return { data: null, modelText: "文章不存在。", meta: { articleId: params.id } };
    }
    return {
      data: article,
      citations: [articleCitation(article)],
      modelText: JSON.stringify({
        ...articleForModel(article),
        content: article.content_text ?? article.content_html ?? null,
        tags: article.tags,
      }),
    };
  },
};

export const fetchArticleContentTool: AgentToolDefinition<typeof articleIdSchema, Article> = {
  id: "rss.fetch_article_content",
  label: "补全文章正文",
  description: "当本地文章正文不完整时，从文章原始链接补全正文。",
  permission: "network",
  schema: articleIdSchema,
  async execute(context, params: ArticleIdParams) {
    assertNotAborted(context);
    const article = await context.services.articles.fetchContent(params.id);
    return {
      data: article,
      citations: [articleCitation(article)],
      modelText: JSON.stringify({
        ...articleForModel(article),
        content: article.content_text ?? article.content_html ?? null,
        tags: article.tags,
      }),
    };
  },
};
