<script setup lang="ts">
import type { MainPanel } from "../types";

defineProps<{ activePanel: MainPanel }>();
const emit = defineEmits<{ select: [panel: MainPanel] }>();
</script>

<template>
  <nav class="activitybar" aria-label="主导航">
    <div class="activity-top">
      <button class="activity-item" :class="{ selected: activePanel === 'home' }" title="首页" aria-label="首页" @click="emit('select', 'home')">⌂</button>
      <button class="activity-item" :class="{ selected: activePanel === 'ai' }" title="AI" aria-label="AI" @click="emit('select', 'ai')">✦</button>
      <button class="activity-item" :class="{ selected: activePanel === 'reading' }" title="阅读" aria-label="阅读" @click="emit('select', 'reading')">▤</button>
      <button class="activity-item" :class="{ selected: activePanel === 'sources' }" title="源" aria-label="源" @click="emit('select', 'sources')">◫</button>
    </div>
    <button class="activity-item activity-settings" :class="{ selected: activePanel === 'settings' }" title="设置" aria-label="设置" @click="emit('select', 'settings')">⚙</button>
  </nav>
</template>
