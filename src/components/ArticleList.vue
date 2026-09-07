<script setup lang="ts">
import type { ArticleListItem, Category } from "../types";

defineProps<{
  articles: ArticleListItem[];
  categories: Category[];
  selectedArticleId: string | null;
  analysisSelection: string[];
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  open: [id: string];
  toggleAnalysis: [id: string];
  toggleStarred: [article: ArticleListItem];
  addFeed: [];
}>();

function formatDate(value?: string | null) {
  if (!value) return "未知时间";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}
</script>

<template>
  <div v-if="loading" class="loading-block">正在加载本地资料库…</div>
  <div v-else-if="error" class="error-banner">{{ error }}</div>
  <div v-else-if="!articles.length" class="empty-state">
    <div class="empty-orbit">◎</div><h2>暂无文章</h2>
    <button class="button button-primary" @click="emit('addFeed')">添加订阅</button>
  </div>
  <div v-else class="article-list">
    <article v-for="article in articles" :key="article.id" class="article-card" :class="{ active: selectedArticleId === article.id, unread: !article.is_read }" @click="emit('open', article.id)">
      <div class="article-meta"><span class="unread-mark" />{{ article.feed_title }}<span>·</span>{{ formatDate(article.published_at) }}<button class="select-analysis" :class="{ checked: analysisSelection.includes(article.id) }" title="加入交叉分析" @click.stop="emit('toggleAnalysis', article.id)">{{ analysisSelection.includes(article.id) ? "✓" : "＋" }}</button></div>
      <h2>{{ article.title }}</h2>
      <p v-if="article.summary" class="article-summary">{{ article.summary.replace(/<[^>]+>/g, "").slice(0, 180) }}</p>
      <div class="article-footer"><span class="article-chips"><i v-if="article.category_id">{{ categories.find((category) => category.id === article.category_id)?.name }}</i><i v-for="tag in article.tags" :key="tag">#{{ tag }}</i></span><span class="card-actions"><button @click.stop="emit('toggleStarred', article)">{{ article.is_starred ? "★" : "☆" }}</button></span></div>
    </article>
  </div>
</template>
