<script setup lang="ts">
import type { AiTask, Article, Category } from "../types";
import ReaderPane from "./ReaderPane.vue";

defineProps<{
  categories: Category[];
  selectedArticle: Article | null;
  aiResult: string;
  aiBusy: boolean;
  aiTask: AiTask | null;
  analysisCount: number;
}>();

const emit = defineEmits<{
  toggleStarred: [article: Article];
  openOriginal: [];
  editOrganization: [];
  loadContent: [];
  runTask: [task: AiTask];
}>();
</script>

<template>
  <section class="reading-workspace">
    <ReaderPane :article="selectedArticle" :categories="categories" :ai-result="aiResult" :ai-busy="aiBusy" :ai-task="aiTask" :analysis-count="analysisCount" @toggle-starred="emit('toggleStarred', $event)" @open-original="emit('openOriginal')" @edit-organization="emit('editOrganization')" @load-content="emit('loadContent')" @run-task="emit('runTask', $event)" />
  </section>
</template>
