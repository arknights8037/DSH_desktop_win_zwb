import type { AgentOutputBlock, AgentTurnResult, OutputAdapter } from "../contracts";
import { articleDigestOutputAdapter } from "./article-digest";
import { evidenceOutputAdapter } from "./evidence";
import { plainTextOutputAdapter } from "./plain-text";

const adapters: OutputAdapter[] = [articleDigestOutputAdapter, evidenceOutputAdapter, plainTextOutputAdapter];

export function adaptAgentOutput(result: AgentTurnResult) {
  return adapters.find((adapter) => adapter.canHandle(result))?.adapt(result) ?? plainTextOutputAdapter.adapt(result);
}

export function renderAgentOutputBlocks(blocks: AgentOutputBlock[]) {
  return blocks.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "article") {
      const article = block.article;
      const summary = article.summary ? `\n${article.summary}` : "";
      return `### ${article.title}\n来源：${article.source}${article.publishedAt ? ` · ${article.publishedAt}` : ""}${summary}\n[阅读原文](${article.url})`;
    }
    const citation = block.citation;
    return `- [${citation.title}](${citation.url ?? "#"})${citation.source ? ` · ${citation.source}` : ""}${citation.quote ? `\n  > ${citation.quote}` : ""}`;
  }).join("\n\n");
}
