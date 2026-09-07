<script setup lang="ts">
import type { Category, Feed, Tag } from "../types";

const props = defineProps<{ feed: Feed | null; categories: Category[]; tags: Tag[] }>();
const emit = defineEmits<{ addFeed: []; editFeed: [feed: Feed]; deleteFeed: [feed: Feed]; openReading: [] }>();

function editSelectedFeed() {
  if (props.feed) emit("editFeed", props.feed);
}

function formatDate(value?: string | null) {
  if (!value) return "未同步";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
</script>

<template>
  <section class="workspace-pane source-workspace">
    <div class="workspace-title-row"><div><span class="eyebrow">源管理</span><h1>{{ feed ? feed.title : "订阅源" }}</h1></div></div>
    <div v-if="feed" class="source-manager-card">
      <div class="source-manager-header"><div class="source-detail-icon">{{ feed.title.slice(0, 1).toUpperCase() }}</div><div class="source-manager-copy"><a :href="feed.url" target="_blank" rel="noreferrer">{{ feed.url }}</a><span v-if="feed.site_url">{{ feed.site_url }}</span></div><button class="button button-secondary icon-only" title="编辑分类和标签" aria-label="编辑分类和标签" @click="editSelectedFeed">☷</button></div>
      <div class="source-manager-stats"><div><span>未读</span><strong>{{ feed.unread_count }}</strong></div><div><span>上次同步</span><strong>{{ formatDate(feed.last_synced_at) }}</strong></div></div>
      <p v-if="feed.description" class="source-manager-description">{{ feed.description }}</p>
      <div class="source-manager-section"><span class="source-manager-label">分类 / 标签</span><div class="reader-chips"><span v-if="feed?.category_id">{{ categories.find((category) => category.id === feed?.category_id)?.name }}</span><span v-for="tagId in feed?.tag_ids ?? []" :key="tagId">#{{ tags.find((tag) => tag.id === tagId)?.name }}</span><span v-if="!feed?.category_id && !(feed?.tag_ids?.length ?? 0)" class="source-manager-muted">未设置</span></div></div>
      <div class="source-manager-actions"><button class="button button-primary" @click="emit('openReading')">阅读文章 →</button><button class="button button-quiet" @click="editSelectedFeed">编辑组织</button><button class="button source-delete-button" @click="emit('deleteFeed', feed)">删除源</button></div>
    </div>
    <div v-else class="source-empty-card"><strong>选择一个订阅源</strong><button class="button button-primary" @click="emit('addFeed')">添加源</button></div>
  </section>
</template>
