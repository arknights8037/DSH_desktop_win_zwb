import type { AgentTurnResult, OutputAdapter } from "../contracts";

export const evidenceOutputAdapter: OutputAdapter = {
  id: "evidence",
  canHandle(result: AgentTurnResult) {
    return result.citations.length > 0;
  },
  adapt(result: AgentTurnResult) {
    return [
      { type: "text", text: result.assistantText || "已整理相关证据。" },
      ...result.citations.map((citation) => ({ type: "evidence" as const, citation })),
    ];
  },
};
