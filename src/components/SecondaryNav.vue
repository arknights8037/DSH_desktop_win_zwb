<script setup lang="ts">
import type { ArticleListItem, Category, Feed, MainPanel, Subpanel, Tag } from "../types";
import { NInput } from "naive-ui";
import ArticleList from "./ArticleList.vue";
import SourceList from "./SourceList.vue";
import OverlayScrollArea from "./OverlayScrollArea.vue";

defineProps<{
  activePanel: MainPanel;
  activeSubpanel: Subpanel;
  feeds: Feed[];
  categories: Category[];
  tags: Tag[];
  selectedFeedId: string | null;
  selectedCategoryId: string | null;
  selectedTagId: string | null;
  totalUnread: number;
  analysisCount: number;
  articles: ArticleListItem[];
  selectedArticleId: string | null;
  analysisSelection: string[];
  loading: boolean;
  error: string;
  searchQuery: string;
}>();

const emit = defineEmits<{
  selectSubpanel: [subpanel: Subpanel];
  selectFeed: [feedId: string];
  selectCategory: [categoryId: string | null];
  selectTag: [tagId: string | null];
  editFeed: [feed: Feed];
  deleteFeed: [feed: Feed];
  editCategory: [category: Category];
  addFeed: [categoryId: string | null];
  addCategory: [];
  openArticle: [id: string];
  toggleAnalysis: [id: string];
  toggleStarred: [article: ArticleListItem];
  updateSearch: [value: string];
  reloadSearch: [];
}>();

</script>

<template>
  <aside class="explorer-panel">
    <OverlayScrollArea>
    <div class="explorer-inner">
      <div v-if="activePanel === 'ai'" class="secondary-menu">
        <button class="explorer-item" :class="{ selected: activeSubpanel === 'ai-reader' }" @click="emit('selectSubpanel', 'ai-reader')"><span>◈</span><span>AI 阅读器</span></button>
        <button class="explorer-item" :class="{ selected: activeSubpanel === 'cross-analysis' }" @click="emit('selectSubpanel', 'cross-analysis')"><span>⌘</span><span>交叉分析</span><b>{{ analysisCount || "" }}</b></button>
        <button class="explorer-item" :class="{ selected: activeSubpanel === 'agent' }" @click="emit('selectSubpanel', 'agent')"><span>✦</span><span>信息流 Agent</span></button>
      </div>

      <div v-else-if="activePanel === 'sources'" class="secondary-menu">
        <button class="explorer-item" :class="{ selected: activeSubpanel === 'sources' && !selectedFeedId }" @click="emit('selectSubpanel', 'sources')"><span>◫</span><span>全部源</span><b>{{ feeds.length || "" }}</b></button>
        <button class="source-tree-add-category" @click="emit('addCategory')">＋ 添加分类</button>
        <SourceList :feeds="feeds" :categories="categories" :tags="tags" :selected-feed-id="selectedFeedId" @select="emit('selectFeed', $event)" @edit="emit('editFeed', $event)" @delete="emit('deleteFeed', $event)" @edit-category="emit('editCategory', $event)" @add="emit('addFeed', $event)" />
      </div>

      <div v-else class="secondary-menu">
        <button class="explorer-item" :class="{ selected: activeSubpanel === 'inbox' }" @click="emit('selectSubpanel', 'inbox')"><span>⌂</span><span>全部文章</span><b>{{ totalUnread || "" }}</b></button>
        <button class="explorer-item" :class="{ selected: activeSubpanel === 'unread' }" @click="emit('selectSubpanel', 'unread')"><span>◌</span><span>未读文章</span><b>{{ totalUnread || "" }}</b></button>
        <button class="explorer-item" :class="{ selected: activeSubpanel === 'starred' }" @click="emit('selectSubpanel', 'starred')"><span>☆</span><span>收藏文章</span></button>
        <div v-if="activePanel === 'reading'" class="reading-filter-section">
          <div class="reading-filter-heading"><span>分组筛选</span><button v-if="selectedCategoryId || selectedTagId" class="button-quiet" @click="emit('selectSubpanel', 'inbox')">清除</button></div>
          <div class="reading-filter-label">分类</div>
          <div class="reading-filter-list"><button class="filter-chip" :class="{ selected: !selectedCategoryId && !selectedTagId }" @click="emit('selectSubpanel', 'inbox')">全部文章</button><button v-for="category in categories" :key="category.id" class="filter-chip" :class="{ selected: selectedCategoryId === category.id }" @click="emit('selectCategory', category.id)"><span>{{ category.icon || '◫' }}</span>{{ category.name }}</button></div>
          <div v-if="tags.length" class="reading-filter-label">标签</div>
          <div class="reading-filter-list"><button v-for="tag in tags" :key="tag.id" class="filter-chip" :class="{ selected: selectedTagId === tag.id }" @click="emit('selectTag', tag.id)">#{{ tag.name }}</button></div>
        </div>
        <div v-if="activePanel === 'reading'" class="secondary-article-list"><div class="explorer-label">文章 · {{ articles.length }}</div><div class="secondary-search"><NInput :value="searchQuery" placeholder="搜索文章…" clearable @update:value="emit('updateSearch', $event)" @keyup.enter="emit('reloadSearch')" /></div><ArticleList :articles="articles" :categories="categories" :selected-article-id="selectedArticleId" :analysis-selection="analysisSelection" :loading="loading" :error="error" @open="emit('openArticle', $event)" @toggle-analysis="emit('toggleAnalysis', $event)" @toggle-starred="emit('toggleStarred', $event)" @add-feed="emit('addFeed', null)" /></div>
      </div>
    </div>
    </OverlayScrollArea>
  </aside>
</template>
