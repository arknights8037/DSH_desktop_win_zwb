import { Type, type Static } from "typebox";
import type { Feed } from "../../types";
import type { AgentToolDefinition } from "../contracts";

const emptySchema = Type.Object({});
type EmptyParams = Static<typeof emptySchema>;

export const listFeedsTool: AgentToolDefinition<typeof emptySchema, Feed[]> = {
  id: "rss.list_feeds",
  label: "查看订阅源",
  description: "列出本地 RSS 订阅源及未读数量，用于判断来源覆盖和主题分布。",
  permission: "read",
  schema: emptySchema,
  async execute(context, _params: EmptyParams) {
    const feeds = await context.services.feeds.list();
    return {
      data: feeds,
      modelText: JSON.stringify(feeds.map((feed) => ({ id: feed.id, title: feed.title, url: feed.url, unreadCount: feed.unread_count, categoryId: feed.category_id }))),
      meta: { count: feeds.length },
    };
  },
};
