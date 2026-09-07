import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "typebox";
import type { AgentToolContext, AgentToolDefinition } from "./contracts";
import { searchArticlesTool, getArticleTool, fetchArticleContentTool } from "./tools/articles";
import { listFeedsTool } from "./tools/feeds";
import { listTaxonomyTool } from "./tools/taxonomy";

type AnyToolDefinition = AgentToolDefinition<TSchema, unknown>;

export interface ToolRegistry {
  register(tool: AnyToolDefinition): void;
  get(id: string): AnyToolDefinition | undefined;
  list(): AnyToolDefinition[];
  createAgentTools(context: AgentToolContext): AgentTool[];
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function modelToolName(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register(tool: AnyToolDefinition) {
    if (this.tools.has(tool.id)) throw new Error(`重复注册 Agent 工具：${tool.id}`);
    this.tools.set(tool.id, tool);
  }

  get(id: string) {
    return this.tools.get(id);
  }

  list() {
    return [...this.tools.values()];
  }

  createAgentTools(context: AgentToolContext) {
    return this.list().map((tool) => ({
      name: modelToolName(tool.id),
      label: tool.label,
      description: tool.description,
      parameters: tool.schema,
      execute: async (toolCallId: string, params: Static<typeof tool.schema>, signal?: AbortSignal) => {
        const executionContext = { ...context, signal: signal ?? context.signal };
        if (tool.permission === "network" && executionContext.allowNetwork === false) {
          throw new Error(`工具 ${tool.id} 需要网络权限`);
        }
        if (tool.permission === "write") {
          if (!executionContext.confirm) throw new Error(`工具 ${tool.id} 需要用户确认`);
          const approved = await executionContext.confirm(`Agent 请求执行：${tool.label}`);
          if (!approved) throw new Error(`用户拒绝执行工具：${tool.id}`);
        }
        executionContext.onToolEvent?.({ type: "tool_started", toolId: tool.id, callId: toolCallId });
        try {
          const result = await tool.execute(executionContext, params);
          executionContext.onToolEvent?.({ type: "tool_finished", toolId: tool.id, callId: toolCallId, result });
          return {
            content: [{ type: "text" as const, text: result.modelText }],
            details: result,
          };
        } catch (cause) {
          throw new Error(`工具 ${tool.id} 执行失败：${errorMessage(cause)}`);
        }
      },
    })) as AgentTool[];
  }
}

export function createDefaultToolRegistry() {
  const registry = new DefaultToolRegistry();
  registry.register(searchArticlesTool);
  registry.register(getArticleTool);
  registry.register(fetchArticleContentTool);
  registry.register(listFeedsTool);
  registry.register(listTaxonomyTool);
  return registry;
}
