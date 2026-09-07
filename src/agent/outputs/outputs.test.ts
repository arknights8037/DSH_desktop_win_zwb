import { describe, expect, it } from "vitest";
import { adaptAgentOutput, renderAgentOutputBlocks } from "./index";

describe("agent output adapters", () => {
  it("turns article tool results into structured digest blocks", () => {
    const blocks = adaptAgentOutput({
      prompt: "推荐文章",
      assistantText: "我找到了相关内容。",
      citations: [],
      toolResults: [{
        toolId: "rss.search_articles",
        callId: "call-1",
        result: {
          data: [{ id: "a1", title: "Agent 文章", feed_title: "来源 A", url: "https://example.com/a1", summary: "简短摘要", published_at: "2026-08-03" }],
          modelText: "[]",
        },
      }],
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ type: "article", article: { id: "a1", title: "Agent 文章" } });
    expect(renderAgentOutputBlocks(blocks)).toContain("[阅读原文](https://example.com/a1)");
  });

  it("falls back to plain text when no structured data exists", () => {
    const blocks = adaptAgentOutput({ prompt: "你好", assistantText: "你好。", citations: [], toolResults: [] });
    expect(blocks).toEqual([{ type: "text", text: "你好。" }]);
  });
});
