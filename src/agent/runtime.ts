import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { getAiApiKey, getProviderConfig } from "../services/tauri";
import type { AgentRunOptions, AgentToolRecord, AgentTurnResult, ToolExecutionResult } from "./contracts";
import { createAgentServices } from "./services";
import { createDefaultToolRegistry } from "./registry";
import { adaptAgentOutput, renderAgentOutputBlocks } from "./outputs";

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function buildPrompt(prompt: string, history: Array<{ role: "user" | "assistant"; content: string }>) {
  if (!history.length) return prompt;
  const context = history.slice(-12).map((message) => `${message.role === "user" ? "用户" : "Agent"}：${message.content}`).join("\n");
  return `这是当前会话的历史上下文，请在此基础上继续回答：\n${context}\n\n用户当前任务：${prompt}`;
}

export async function runAgent(options: AgentRunOptions): Promise<AgentTurnResult> {
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("Agent 任务不能为空");
  const config = await getProviderConfig();
  if (!config) throw new Error("请先在设置中配置 AI Provider");
  const apiKey = await getAiApiKey(config.api_key_ref);
  const model: Model<"openai-responses"> = {
    id: config.model,
    name: config.model,
    api: "openai-responses",
    provider: "ai4rss",
    baseUrl: config.base_url.replace(/\/+$/, ""),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };

  const services = createAgentServices();
  let history = await services.sessions.listMessages(options.sessionId);
  if (!history.length && options.bootstrapHistory?.length) {
    for (const message of options.bootstrapHistory) {
      await services.sessions.appendMessage(options.sessionId, message.role, message.content);
    }
    history = options.bootstrapHistory;
  }
  await services.sessions.appendMessage(options.sessionId, "user", prompt);
  const toolResults: AgentToolRecord[] = [];
  const registry = createDefaultToolRegistry();
  const toolContext = {
    sessionId: options.sessionId,
    services,
    confirm: options.confirm,
    allowNetwork: options.allowNetwork ?? true,
    onToolEvent: (event: { type: "tool_started" | "tool_finished"; toolId: string; callId: string; result?: ToolExecutionResult<unknown> }) => {
      if (event.type === "tool_started") {
        options.onEvent?.({ type: "tool_started", toolId: event.toolId, callId: event.callId });
      } else if (event.result) {
        toolResults.push({ toolId: event.toolId, callId: event.callId, result: event.result });
        options.onEvent?.({ type: "tool_finished", toolId: event.toolId, callId: event.callId, result: event.result });
      }
    },
  };
  const tools = registry.createAgentTools(toolContext);
  const provider = createProvider({
    id: "ai4rss",
    name: "AI4RSS Provider",
    baseUrl: model.baseUrl,
    auth: {
      apiKey: {
        name: "AI4RSS API Key",
        resolve: async () => ({ auth: { apiKey }, source: "AI4RSS system keyring" }),
      },
    },
    models: [model],
    api: openAIResponsesApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  const chunks: string[] = [];
  const agent = new Agent({
    streamFn: (streamModel, context, streamOptions) => models.stream(streamModel, context, streamOptions),
    getApiKey: async () => apiKey,
    initialState: {
      model,
      systemPrompt: "你是 AI4RSS 的本地阅读 Agent。你可以自主使用所有已注册的本地 RSS 工具完成任务；只使用工具返回的事实，回答时给出文章标题、来源和不确定性，不要向用户解释工具配置。",
      tools,
      messages: [],
    },
    toolExecution: "sequential",
  });
  agent.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      chunks.push(event.assistantMessageEvent.delta);
      options.onEvent?.({ type: "assistant_delta", delta: event.assistantMessageEvent.delta });
    }
  });

  try {
    await agent.prompt(buildPrompt(prompt, history));
    const result: AgentTurnResult = {
      prompt,
      assistantText: chunks.join(""),
      toolResults,
      citations: toolResults.flatMap((record) => record.result.citations ?? []),
    };
    const blocks = adaptAgentOutput(result);
    options.onEvent?.({ type: "output", blocks });
    await services.sessions.appendMessage(options.sessionId, "assistant", renderAgentOutputBlocks(blocks));
    return result;
  } catch (cause) {
    const message = errorMessage(cause);
    options.onEvent?.({ type: "error", message });
    throw new Error(message);
  }
}
