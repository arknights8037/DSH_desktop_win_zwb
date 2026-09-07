import type { Static, TSchema } from "typebox";
import type { AgentServices } from "./services";

export type ToolPermission = "read" | "write" | "network";

export interface ToolCitation {
  articleId?: string;
  title: string;
  url?: string | null;
  source?: string | null;
  quote?: string | null;
}

export interface ToolExecutionResult<T> {
  data: T;
  modelText: string;
  citations?: ToolCitation[];
  meta?: Record<string, unknown>;
}

export interface AgentToolContext {
  sessionId: string;
  signal?: AbortSignal;
  services: AgentServices;
  confirm?: (reason: string) => Promise<boolean>;
  allowNetwork?: boolean;
  onToolEvent?: (event: ToolLifecycleEvent) => void;
}

export interface AgentToolDefinition<TParams extends TSchema = TSchema, TResult = unknown> {
  id: string;
  label: string;
  description: string;
  permission: ToolPermission;
  schema: TParams;
  execute(
    context: AgentToolContext,
    params: Static<TParams>,
  ): Promise<ToolExecutionResult<TResult>>;
}

export interface ToolLifecycleEvent {
  type: "tool_started" | "tool_finished";
  toolId: string;
  callId: string;
  result?: ToolExecutionResult<unknown>;
}

export interface AgentConversationMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentOutputArticle {
  id: string;
  title: string;
  source: string;
  url: string;
  summary?: string | null;
  publishedAt?: string | null;
  reason?: string | null;
}

export type AgentOutputBlock =
  | { type: "text"; text: string }
  | { type: "article"; article: AgentOutputArticle }
  | { type: "evidence"; citation: ToolCitation };

export interface AgentToolRecord {
  toolId: string;
  callId: string;
  result: ToolExecutionResult<unknown>;
}

export interface AgentTurnResult {
  prompt: string;
  assistantText: string;
  toolResults: AgentToolRecord[];
  citations: ToolCitation[];
}

export interface OutputAdapter {
  id: string;
  canHandle(result: AgentTurnResult): boolean;
  adapt(result: AgentTurnResult): AgentOutputBlock[];
}

export type AgentEvent =
  | { type: "assistant_delta"; delta: string }
  | { type: "tool_started"; toolId: string; callId: string }
  | { type: "tool_finished"; toolId: string; callId: string; result: ToolExecutionResult<unknown> }
  | { type: "output"; blocks: AgentOutputBlock[] }
  | { type: "error"; message: string };

export interface AgentRunOptions {
  sessionId: string;
  prompt: string;
  bootstrapHistory?: AgentConversationMessage[];
  onEvent?: (event: AgentEvent) => void;
  confirm?: (reason: string) => Promise<boolean>;
  allowNetwork?: boolean;
}
