export type AiTask = "translate" | "summarize" | "credibility" | "cross-analysis";
export type MainPanel = "home" | "ai" | "reading" | "sources" | "settings";
export type Subpanel = "inbox" | "unread" | "starred" | "ai-reader" | "cross-analysis" | "agent" | "sources";

export interface Feed {
  id: string;
  url: string;
  title: string;
  site_url?: string | null;
  description?: string | null;
  category_id?: string | null;
  tag_ids: string[];
  unread_count: number;
  last_synced_at?: string | null;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ArticleListItem {
  id: string;
  feed_id: string;
  feed_title: string;
  title: string;
  url: string;
  author?: string | null;
  published_at?: string | null;
  summary?: string | null;
  category_id?: string | null;
  is_read: boolean;
  is_starred: boolean;
  tags: string[];
}

export interface Article extends ArticleListItem {
  content_html?: string | null;
  content_text?: string | null;
}

export interface ArticleFilter {
  feed_id?: string | null;
  category_id?: string | null;
  tag_id?: string | null;
  unread_only: boolean;
  starred_only: boolean;
  query?: string | null;
  published_from?: string | null;
  published_to?: string | null;
  limit?: number;
}

export interface ProviderConfig {
  base_url: string;
  model: string;
  api_key_ref: string;
  api: "openai-responses";
  timeout_ms: number;
}

export interface AnalysisResult {
  conclusion: string;
  keyPoints: string[];
  evidence: Array<{ articleId: string; quote?: string }>;
  agreements?: string[];
  disagreements?: string[];
  confidence: "low" | "medium" | "high";
  caveats: string[];
}

export interface AiTaskResult {
  task: AiTask;
  article_ids: string[];
  content: string;
  created_at: string;
}

export interface AgentSession {
  id: string;
  created_at: string;
}

export interface AgentMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export type AgentMode = "explore" | "digest" | "compare";
export type AgentSessionGroup = string;

export interface AgentHistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentHistorySession {
  id: string;
  backendSessionId?: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  group: AgentSessionGroup;
  pinned: boolean;
  archived: boolean;
  messages: AgentHistoryMessage[];
}
