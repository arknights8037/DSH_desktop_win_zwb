import type { AgentTurnResult, OutputAdapter } from "../contracts";

export const plainTextOutputAdapter: OutputAdapter = {
  id: "plain-text",
  canHandle: () => true,
  adapt(result: AgentTurnResult) {
    return [{ type: "text", text: result.assistantText || "Agent 没有返回文本结果。" }];
  },
};
