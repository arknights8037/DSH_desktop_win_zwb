<script setup lang="ts">
import { computed } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { AiTask, Article, Category } from "../types";
import OverlayScrollArea from "./OverlayScrollArea.vue";

const props = defineProps<{
  article: Article | null;
  categories: Category[];
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

const lazyImageAttributes = ["data-src", "data-original", "data-lazy-src", "data-original-src", "data-url"];

function isPlaceholderSource(value: string | null) {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "about:blank" || /(?:spacer|placeholder|blank)\.(?:gif|png|jpg|jpeg)(?:[?#].*)?$/.test(normalized) || /^data:image\/gif;base64,r0lgodlhaqaba/.test(normalized);
}

function resolveImageUrl(value: string | null, baseUrl: string) {
  if (!value?.trim()) return null;
  try {
    const resolved = new URL(value.trim(), baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.href : null;
  } catch {
    return null;
  }
}

function normalizeImageSources(html: string, baseUrl: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("img").forEach((image) => {
    const fallback = lazyImageAttributes.map((attribute) => image.getAttribute(attribute)).find((value) => Boolean(value?.trim()));
    const source = isPlaceholderSource(image.getAttribute("src")) ? fallback : image.getAttribute("src");
    const resolvedSource = resolveImageUrl(source ?? null, baseUrl);
    if (resolvedSource) image.setAttribute("src", resolvedSource);

    const sourceSet = image.getAttribute("srcset") || image.getAttribute("data-srcset");
    if (sourceSet) {
      const resolvedSourceSet = sourceSet.split(",").map((candidate) => {
        const [url, ...descriptor] = candidate.trim().split(/\s+/);
        const resolved = resolveImageUrl(url, baseUrl);
        return resolved ? [resolved, ...descriptor].join(" ") : candidate.trim();
      }).join(", ");
      image.setAttribute("srcset", resolvedSourceSet);
    }
    lazyImageAttributes.concat("data-srcset").forEach((attribute) => image.removeAttribute(attribute));
  });
  return document.body.innerHTML;
}

const articleHtml = computed(() => {
  const article = props.article;
  if (!article) return "";
  const html = article.content_html || article.summary || "<p>暂无正文。可以尝试抓取原文，或打开来源网站。</p>";
  return DOMPurify.sanitize(normalizeImageSources(html, article.url));
});
const aiHtml = computed(() => DOMPurify.sanitize(marked.parse(props.aiResult || "", { async: false }) as string));

function formatDate(value?: string | null) {
  if (!value) return "未知时间";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}
</script>

<template>
  <section class="reader-column">
    <div v-if="!article" class="reader-empty"><div class="reader-symbol">R/</div><h2>选择一篇文章</h2></div>
    <template v-else>
      <div class="reader-toolbar"><span class="eyebrow">{{ article.feed_title }}</span><div class="reader-toolbar-actions"><button class="button button-quiet icon-only" title="编辑文章分类和标签" aria-label="编辑文章分类和标签" @click="emit('editOrganization')">☷</button><button class="button button-quiet icon-only" :title="article.is_starred ? '取消收藏' : '收藏'" :aria-label="article.is_starred ? '取消收藏' : '收藏'" @click="emit('toggleStarred', article)">{{ article.is_starred ? "★" : "☆" }}</button><button class="button button-quiet icon-only" title="打开原站" aria-label="打开原站" @click="emit('openOriginal')">↗</button></div></div>
      <OverlayScrollArea class="reader-scroll"><div class="reader-content"><div class="eyebrow">{{ formatDate(article.published_at) }}<span v-if="article.author"> · {{ article.author }}</span></div><h1>{{ article.title }}</h1><div class="reader-chips"><span v-if="article.category_id">{{ categories.find((category) => category.id === article?.category_id)?.name }}</span><span v-for="tag in article.tags" :key="tag">#{{ tag }}</span></div><div class="reading-actions"><button v-if="!article.content_html" class="button button-secondary" @click="emit('loadContent')">抓取正文</button><button class="button" :class="{ 'is-loading': aiBusy && aiTask === 'translate' }" @click="emit('runTask', 'translate')">翻译</button><button class="button" :class="{ 'is-loading': aiBusy && aiTask === 'summarize' }" @click="emit('runTask', 'summarize')">总结</button><button class="button" :class="{ 'is-loading': aiBusy && aiTask === 'credibility' }" @click="emit('runTask', 'credibility')">可信度</button></div><div class="article-body" v-html="articleHtml" /></div></OverlayScrollArea>
      <div v-if="aiResult" class="ai-dock"><div class="ai-dock-title"><span class="ai-pulse" /><span>AI 结果</span><span v-if="analysisCount" class="selection-count">{{ analysisCount }} 篇已选</span></div><div class="ai-result" v-html="aiHtml" /></div>
    </template>
  </section>
</template>
