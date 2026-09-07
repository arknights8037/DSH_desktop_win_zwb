import { describe, expect, it, vi } from "vitest";
import { searchArticlesTool } from "./articles";
import type { AgentServices } from "../services";

describe("searchArticlesTool", () => {
  it("maps flexible Agent filters to the shared article service", async () => {
    const search = vi.fn(async () => []);
    const context = {
      sessionId: "test-session",
      services: { articles: { search }, feeds: {}, taxonomy: {}, sessions: {} } as unknown as AgentServices,
    };

    await searchArticlesTool.execute(context, {
      query: "agent",
      feedId: "feed-1",
      categoryId: "category-1",
      tagId: "tag-1",
      publishedFrom: "2026-08-01T00:00:00Z",
      publishedTo: "2026-08-03T00:00:00Z",
      unreadOnly: true,
      starredOnly: false,
      limit: 10,
    });

    expect(search).toHaveBeenCalledWith({
      feed_id: "feed-1",
      category_id: "category-1",
      tag_id: "tag-1",
      query: "agent",
      published_from: "2026-08-01T00:00:00Z",
      published_to: "2026-08-03T00:00:00Z",
      unread_only: true,
      starred_only: false,
      limit: 10,
    });
  });
});
