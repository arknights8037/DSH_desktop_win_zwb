<script setup lang="ts">
import type { AgentHistorySession } from "../types";

const props = defineProps<{
  sessions: AgentHistorySession[];
  activeSessionId: string | null;
}>();

const emit = defineEmits<{
  select: [sessionId: string];
  create: [];
  "create-group": [];
}>();

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
</script>

<template>
  <aside class="ai-history-panel">
    <div class="ai-history-inner">
      <header class="ai-history-header">
        <div>
          <span class="ai-history-eyebrow">AI4RSS</span>
          <h2>历史对话</h2>
        </div>
        <div class="ai-history-actions">
          <button class="ai-history-action primary" title="新建对话" @click="emit('create')">＋ 对话</button>
          <button class="ai-history-action" title="新建分组" @click="emit('create-group')">＋ 分组</button>
        </div>
      </header>

      <div class="ai-history-list simple">
        <div v-if="!sessions.length" class="ai-history-empty">
          <span>⌁</span>
          <strong>还没有对话</strong>
          <p>新建一个对话开始使用 Agent。</p>
        </div>
        <article v-for="session in props.sessions" :key="session.id" class="ai-history-item" :class="{ selected: activeSessionId === session.id }" tabindex="0" @click="emit('select', session.id)" @keydown.enter="emit('select', session.id)">
          <div class="ai-history-item-top">
            <strong>{{ session.title }}</strong>
            <time>{{ formatTime(session.updatedAt) }}</time>
          </div>
          <p>{{ session.preview }}</p>
          <span class="ai-history-group-name">{{ session.group }}</span>
        </article>
      </div>
    </div>
  </aside>
</template>
