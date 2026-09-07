import type { Article, ArticleFilter, ArticleListItem, Category, Feed, Tag } from "../types";
import { fetchArticleContent, getArticle, listAgentMessages, listArticles, listCategories, listFeeds, listTags, saveAgentMessage } from "../services/tauri";
import type { AgentConversationMessage } from "./contracts";

export interface AgentServices {
  articles: {
    search(filter: ArticleFilter): Promise<ArticleListItem[]>;
    get(id: string): Promise<Article | null>;
    fetchContent(id: string): Promise<Article>;
  };
  feeds: {
    list(): Promise<Feed[]>;
  };
  taxonomy: {
    categories(): Promise<Category[]>;
    tags(): Promise<Tag[]>;
  };
  sessions: {
    listMessages(sessionId: string): Promise<AgentConversationMessage[]>;
    appendMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<void>;
  };
}

export function createAgentServices(): AgentServices {
  return {
    articles: {
      search: listArticles,
      get: getArticle,
      fetchContent: fetchArticleContent,
    },
    feeds: {
      list: listFeeds,
    },
    taxonomy: {
      categories: listCategories,
      tags: listTags,
    },
    sessions: {
      async listMessages(sessionId) {
        const messages = await listAgentMessages(sessionId);
        return messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({
            role: message.role as "user" | "assistant",
            content: message.content,
            createdAt: message.created_at,
          }));
      },
      async appendMessage(sessionId, role, content) {
        await saveAgentMessage(sessionId, role, content);
      },
    },
  };
}
