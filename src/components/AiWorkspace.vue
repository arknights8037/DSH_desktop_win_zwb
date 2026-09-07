<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { AgentHistoryMessage } from "../types";

const props = defineProps<{
  sessionTitle: string;
  messages: AgentHistoryMessage[];
  agentPrompt: string;
  agentBusy: boolean;
}>();

const emit = defineEmits<{
  "update:agentPrompt": [value: string];
  runAgent: [prompt: string];
  "new-session": [];
}>();

function messageHtml(content: string) {
  return DOMPurify.sanitize(marked.parse(content || "", { async: false }) as string);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function send() {
  const prompt = props.agentPrompt.trim();
  if (!prompt || props.agentBusy) return;
  emit("runAgent", prompt);
}
</script>

<template>
  <section class="ai-workspace minimal">
    <header class="ai-conversation-header">
      <div class="ai-conversation-heading">
        <span class="ai-history-eyebrow">AI AGENT</span>
        <h1>{{ sessionTitle }}</h1>
      </div>
      <button class="button button-quiet" @click="emit('new-session')">＋ 新建对话</button>
    </header>

    <div v-if="!messages.length" class="ai-minimal-empty">
      <span>✦</span>
      <h2>有什么想研究的？</h2>
      <p>直接提问，Agent 会从本地信息流中查找文章并整理答案。</p>
    </div>

    <div v-else class="ai-message-stack">
      <article v-for="message in messages" :key="message.id" class="ai-message" :class="message.role">
        <div class="ai-message-avatar">{{ message.role === "user" ? "YOU" : "AI" }}</div>
        <div class="ai-message-body">
          <div class="ai-message-meta"><strong>{{ message.role === "user" ? "你" : "AI4RSS Agent" }}</strong><time>{{ formatTime(message.createdAt) }}</time></div>
          <div class="ai-message-content" v-html="messageHtml(message.content)" />
        </div>
      </article>
      <div v-if="agentBusy" class="ai-thinking"><span class="ai-thinking-dots"><i /><i /><i /></span>正在思考…</div>
    </div>

    <footer class="ai-composer-shell">
      <div class="ai-composer-input-row">
        <textarea :value="agentPrompt" rows="3" placeholder="输入你的问题…" @input="emit('update:agentPrompt', ($event.target as HTMLTextAreaElement).value)" @keydown.meta.enter.prevent="send" @keydown.ctrl.enter.prevent="send" />
        <button class="ai-send-button" :disabled="agentBusy || !agentPrompt.trim()" @click="send"><span>{{ agentBusy ? "处理中" : "发送" }}</span><b>↗</b></button>
      </div>
      <div class="ai-composer-hint">⌘ / Ctrl + Enter 发送</div>
    </footer>
  </section>
</template>
