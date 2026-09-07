import { Type, type Static } from "typebox";
import type { Category, Tag } from "../../types";
import type { AgentToolDefinition } from "../contracts";

const emptySchema = Type.Object({});
type EmptyParams = Static<typeof emptySchema>;

export interface TaxonomyResult {
  categories: Category[];
  tags: Tag[];
}

export const listTaxonomyTool: AgentToolDefinition<typeof emptySchema, TaxonomyResult> = {
  id: "rss.list_taxonomy",
  label: "查看分类和标签",
  description: "列出本地 RSS 的分类与标签，帮助组合文章搜索条件。",
  permission: "read",
  schema: emptySchema,
  async execute(context, _params: EmptyParams) {
    const [categories, tags] = await Promise.all([
      context.services.taxonomy.categories(),
      context.services.taxonomy.tags(),
    ]);
    return {
      data: { categories, tags },
      modelText: JSON.stringify({
        categories: categories.map((category) => ({ id: category.id, name: category.name })),
        tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
      }),
    };
  },
};
