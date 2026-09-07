<script setup lang="ts">
defineProps<{ totalUnread: number; feedCount: number; articleCount: number }>();
const emit = defineEmits<{ openReading: []; openSources: []; sync: [] }>();
</script>

<template>
  <section class="workspace-pane home-workspace">
    <div class="workspace-title-row"><h1>今天读什么</h1><button class="button button-secondary" @click="emit('sync')">同步 ↻</button></div>
    <div class="overview-grid"><div class="overview-card"><span>未读文章</span><strong>{{ totalUnread }}</strong><button class="button button-quiet" @click="emit('openReading')">阅读 →</button></div><div class="overview-card"><span>订阅源</span><strong>{{ feedCount }}</strong><button class="button button-quiet" @click="emit('openSources')">源管理 →</button></div><div class="overview-card"><span>文章总数</span><strong>{{ articleCount }}</strong></div></div>
  </section>
</template>
