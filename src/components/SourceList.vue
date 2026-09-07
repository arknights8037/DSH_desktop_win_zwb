<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Category, Feed, Tag } from "../types";

const props = defineProps<{
  feeds: Feed[];
  categories: Category[];
  tags: Tag[];
  selectedFeedId: string | null;
}>();

const emit = defineEmits<{
  select: [feedId: string];
  edit: [feed: Feed];
  delete: [feed: Feed];
  editCategory: [category: Category];
  add: [categoryId: string | null];
}>();

const expanded = ref<Record<string, boolean>>({});
const groups = computed<Category[]>(() => props.categories);

watch(groups, (nextGroups) => {
  for (const group of nextGroups) {
    if (expanded.value[group.id] === undefined) expanded.value[group.id] = true;
  }
}, { immediate: true });

function isExpanded(id: string) {
  return expanded.value[id] !== false;
}

function toggleGroup(id: string) {
  expanded.value[id] = !isExpanded(id);
}

function groupFeeds(group: Category) {
  return props.feeds.filter((feed) => group.id === "inbox"
    ? !feed.category_id || feed.category_id === group.id
    : feed.category_id === group.id);
}
</script>

<template>
  <div class="source-tree">
    <div v-for="group in groups" :key="group.id" class="source-group">
      <div class="source-group-row" :class="{ expanded: isExpanded(group.id) }" role="button" tabindex="0" @click="toggleGroup(group.id)" @keydown.enter="toggleGroup(group.id)" @keydown.space.prevent="toggleGroup(group.id)">
        <span class="tree-chevron">›</span>
        <span class="source-group-icon" :style="{ color: group.color }">{{ group.icon || "◫" }}</span>
        <span class="source-group-name">{{ group.name }}</span>
        <b>{{ groupFeeds(group).length || "" }}</b>
        <button class="source-group-edit" title="编辑分组" aria-label="编辑分组" @click.stop="emit('editCategory', group)">✎</button>
      </div>

      <div v-if="isExpanded(group.id)" class="source-group-children">
        <div v-if="!groupFeeds(group).length" class="source-group-empty">暂无源</div>
        <div v-for="feed in groupFeeds(group)" :key="feed.id" class="source-row" :class="{ selected: selectedFeedId === feed.id }">
          <button class="source-main" @click="emit('select', feed.id)">
            <span class="feed-favicon">{{ feed.title.slice(0, 1).toUpperCase() }}</span>
            <span class="source-copy">
              <strong>{{ feed.title }}</strong>
              <small><span v-for="tagId in feed.tag_ids" :key="tagId">#{{ props.tags.find((tag: Tag) => tag.id === tagId)?.name }} </span></small>
            </span>
            <b v-if="feed.unread_count">{{ feed.unread_count }}</b>
          </button>
          <div class="source-actions"><button class="source-edit" title="编辑源的分类和标签" aria-label="编辑源的分类和标签" @click="emit('edit', feed)">···</button><button class="source-delete" title="删除订阅源" aria-label="删除订阅源" @click="emit('delete', feed)">×</button></div>
        </div>
        <button class="source-group-add-row" @click="emit('add', group.id)"><span>＋</span><span>添加源</span></button>
      </div>
    </div>
  </div>
</template>
