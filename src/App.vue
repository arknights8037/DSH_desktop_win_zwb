<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { NConfigProvider } from "naive-ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLibraryStore } from "./stores/library";
import { getProviderConfig, runAiTask, saveProviderConfig, startAgentSession, validateFeed } from "./services/tauri";
import { runAgent as runAgentRuntime, type AgentEvent } from "./services/agent-adapter";
import { renderAgentOutputBlocks } from "./agent/outputs";
import type { AgentHistoryMessage, AgentHistorySession, AiTask, Category, Feed, MainPanel, ProviderConfig, Subpanel } from "./types";
import { toggleSelection } from "./utils/selection";
import { applyTypographyPreferences, readStoredTypographyPreferences } from "./utils/typography";
import { applyCustomPalette, clearCustomPalette, readStoredCustomPalette } from "./utils/theme";
import { matchesShortcut, readStoredShortcuts, type ShortcutId } from "./utils/shortcuts";
import ActivityBar from "./components/ActivityBar.vue";
import AiHistorySidebar from "./components/AiHistorySidebar.vue";
import AiWorkspace from "./components/AiWorkspace.vue";
import HomeWorkspace from "./components/HomeWorkspace.vue";
import OverlayScrollArea from "./components/OverlayScrollArea.vue";
import ReadingWorkspace from "./components/ReadingWorkspace.vue";
import SecondaryNav from "./components/SecondaryNav.vue";
import SourceWorkspace from "./components/SourceWorkspace.vue";
import SettingsWorkspace from "./components/SettingsWorkspace.vue";
import WindowTitlebar from "./components/WindowTitlebar.vue";
import LibraryModals from "./components/LibraryModals.vue";

type CreateCategoryTarget = "feed" | "article" | "new-feed" | "source";
type CreateTagTarget = "feed" | "article" | "new-feed";

const library = useLibraryStore();
const activePanel = ref<MainPanel>("home");
const activeSubpanel = ref<Subpanel>("inbox");
const skin = ref(localStorage.getItem("ai4rss-skin") || "midnight");
const showAddFeed = ref(false);
const showFeedOrganization = ref(false);
const showArticleOrganization = ref(false);
const showCreateCategory = ref(false);
const showCreateTag = ref(false);
const organizationFeed = ref<Feed | null>(null);
const newFeedUrl = ref("");
const newFeedCategory = ref<string | null>(null);
const newFeedTags = ref<string[]>([]);
const feedCategoryDraft = ref<string | null>(null);
const feedTagsDraft = ref<string[]>([]);
const articleCategoryDraft = ref<string | null>(null);
const articleTagsDraft = ref<string[]>([]);
const createCategoryTarget = ref<CreateCategoryTarget>("source");
const editingCategoryId = ref<string | null>(null);
const newCategoryName = ref("");
const newCategoryIcon = ref("◫");
const createTagTarget = ref<CreateTagTarget>("new-feed");
const newTagName = ref("");
const createMessage = ref("");
const feedPreview = ref<{ title: string; description?: string | null; item_count: number } | null>(null);
const feedBusy = ref(false);
const feedMessage = ref("");
const aiBusy = ref(false);
const aiTask = ref<AiTask | null>(null);
const aiResult = ref("");
const analysisSelection = ref<string[]>([]);
const agentPrompt = ref("");
const agentBusy = ref(false);
const agentSessions = ref<AgentHistorySession[]>([]);
const activeAgentSessionId = ref<string | null>(null);
const agentGroups = ref<string[]>(["今天", "本周", "收藏"]);
const providerDraft = ref<ProviderConfig>({
  base_url: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  api_key_ref: "default",
  api: "openai-responses",
  timeout_ms: 60000,
});
const providerApiKey = ref("");

applyTypographyPreferences(readStoredTypographyPreferences());
if (skin.value === "custom") applyCustomPalette(readStoredCustomPalette());

const skinOptions = [
  { id: "midnight", label: "Midnight", note: "深色工作台" },
  { id: "paper", label: "Paper", note: "暖白阅读" },
  { id: "violet", label: "Violet", note: "紫色夜景" },
];
const organizationFeedTagNames = computed<string[]>(() => organizationFeed.value?.tag_ids.map((id) => library.tags.find((tag) => tag.id === id)?.name).filter((name): name is string => Boolean(name)) ?? []);
const selectedFeed = computed(() => library.feeds.find((feed) => feed.id === library.selectedFeedId) ?? null);
const newFeedCategoryName = computed(() => library.categories.find((category) => category.id === newFeedCategory.value)?.name ?? "");
const activeAgentSession = computed(() => agentSessions.value.find((session) => session.id === activeAgentSessionId.value) ?? null);

const agentHistoryKey = "ai4rss-agent-history";

function seedAgentHistory(): AgentHistorySession[] {
  const now = Date.now();
  return [
    {
      id: "demo-ai-agent",
      title: "今天值得读的 AI Agent 文章",
      preview: "从 128 篇订阅中筛出 4 篇，重点关注工具调用和上下文工程。",
      createdAt: new Date(now - 18 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 4 * 60 * 1000).toISOString(),
      group: "今天",
      pinned: true,
      archived: false,
      messages: [
        { id: "demo-ai-agent-u", role: "user", content: "今天哪些 AI Agent 领域的东西最值得看？", createdAt: new Date(now - 18 * 60 * 1000).toISOString() },
        { id: "demo-ai-agent-a", role: "assistant", content: "## 今日精选 · 4 篇\n\n我从本地信息流里按**新鲜度、引用密度和与你的阅读兴趣**筛了一轮，建议先看这 4 篇：\n\n1. **Tool use 正在进入工作流，而不是聊天框**\n   - 重点：工具调用、失败重试、可观测性。\n   - 为什么值得看：它解释了 Agent 如何从“会回答”变成“能完成任务”。\n\n2. **Context engineering 的下一步**\n   - 重点：上下文压缩、检索排序、长期记忆。\n   - 一句话摘要：好的 Agent 先管理信息，再生成答案。\n\n3. **小模型如何成为可靠的执行层**\n   - 重点：路由、成本和延迟。\n\n4. **评估 Agent，不要只看最终答案**\n   - 重点：轨迹评估、工具成功率和人工接管。\n\n> 推荐顺序：2 → 1 → 4 → 3。要不要我继续把它们整理成一份 5 分钟简报？", createdAt: new Date(now - 4 * 60 * 1000).toISOString() },
      ],
    },
    {
      id: "demo-context-engineering",
      title: "模型上下文：从检索到记忆",
      preview: "整理了上下文压缩、检索排序与长期记忆的差异。",
      createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      group: "本周",
      pinned: false,
      archived: false,
      messages: [
        { id: "demo-context-u", role: "user", content: "找出关于模型上下文的不同观点。", createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() },
        { id: "demo-context-a", role: "assistant", content: "已按上下文压缩、检索排序、长期记忆三个主题归类。核心分歧在于：**上下文应该更长，还是更相关？**", createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() },
      ],
    },
    {
      id: "demo-rss-cleanup",
      title: "RSS 订阅源清理建议",
      preview: "识别低信噪比来源，并保留可形成互补视角的订阅。",
      createdAt: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
      group: "收藏",
      pinned: true,
      archived: false,
      messages: [
        { id: "demo-rss-u", role: "user", content: "帮我检查 RSS 订阅源，哪些可以合并或取消？", createdAt: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString() },
        { id: "demo-rss-a", role: "assistant", content: "我会结合更新频率、重复主题和文章打开率，给出保留、合并、观察三档建议。", createdAt: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString() },
      ],
    },
  ];
}

function persistAgentHistory() {
  localStorage.setItem(agentHistoryKey, JSON.stringify(agentSessions.value));
}

function loadAgentHistory() {
  try {
    const raw = localStorage.getItem(agentHistoryKey);
    const parsed = raw ? JSON.parse(raw) as AgentHistorySession[] : [];
    agentSessions.value = Array.isArray(parsed) && parsed.length ? parsed : seedAgentHistory();
  } catch {
    agentSessions.value = seedAgentHistory();
  }
  const groupNames = agentSessions.value.map((session) => ({ today: "今天", week: "本周", saved: "收藏", archive: "归档" }[session.group] ?? session.group));
  agentSessions.value.forEach((session, index) => { session.group = groupNames[index]; });
  agentGroups.value = Array.from(new Set(["今天", "本周", "收藏", ...groupNames]));
  activeAgentSessionId.value = agentSessions.value[0]?.id ?? null;
  persistAgentHistory();
}

function createAgentSession(groupName = "今天") {
  const now = new Date().toISOString();
  const session: AgentHistorySession = {
    id: crypto.randomUUID(),
    title: "新对话",
    preview: "还没有消息，开始一个新的研究任务吧。",
    createdAt: now,
    updatedAt: now,
    group: groupName,
    pinned: false,
    archived: false,
    messages: [],
  };
  agentSessions.value = [session, ...agentSessions.value];
  activeAgentSessionId.value = session.id;
  agentPrompt.value = "";
  persistAgentHistory();
}

function selectAgentSession(id: string) {
  activeAgentSessionId.value = id;
  agentPrompt.value = "";
}

function createAgentGroup() {
  const groupName = window.prompt("请输入分组名称");
  if (!groupName?.trim()) return;
  const name = groupName.trim();
  if (!agentGroups.value.includes(name)) agentGroups.value = [...agentGroups.value, name];
  createAgentSession(name);
}

onMounted(async () => {
  loadAgentHistory();
  await library.loadLibrary();
  const config = await getProviderConfig();
  if (config) providerDraft.value = config;
});

function handleGlobalShortcut(event: KeyboardEvent) {
  if (document.documentElement.dataset.shortcutRecording === "true") return;
  const shortcuts = readStoredShortcuts();
  const action = (Object.entries(shortcuts) as Array<[ShortcutId, string]>).find(([, shortcut]) => matchesShortcut(event, shortcut))?.[0];
  if (!action) return;
  event.preventDefault();
  if (action === "openSettings") void choosePanel("settings");
  if (action === "goHome") void choosePanel("home");
  if (action === "goReading") void choosePanel("reading");
  if (action === "goAi") void choosePanel("ai");
  if (action === "goSources") void choosePanel("sources");
  if (action === "sync") void library.sync();
}

onMounted(() => window.addEventListener("keydown", handleGlobalShortcut));
onUnmounted(() => window.removeEventListener("keydown", handleGlobalShortcut));

watch(() => library.searchQuery, (value) => {
  if (!value) void library.loadArticles();
});

function setSkin(value: string) {
  skin.value = value;
  localStorage.setItem("ai4rss-skin", value);
  if (value === "custom") applyCustomPalette(readStoredCustomPalette());
  else clearCustomPalette();
}

watch(skin, (value) => {
  document.documentElement.dataset.skin = value;
}, { immediate: true });

async function choosePanel(panel: MainPanel) {
  activePanel.value = panel;
  if (panel === "home") {
    activeSubpanel.value = "inbox";
    await library.selectInbox(false);
  } else if (panel === "reading") {
    activeSubpanel.value = "unread";
    await library.selectInbox(true);
  } else if (panel === "ai") {
    activeSubpanel.value = "ai-reader";
  } else if (panel === "settings") {
    return;
  } else {
    activeSubpanel.value = "sources";
    await library.selectInbox(false);
  }
}

async function chooseSubpanel(panel: Subpanel) {
  activeSubpanel.value = panel;
  if (panel === "inbox") await library.selectInbox(false);
  if (panel === "unread") await library.selectInbox(true);
  if (panel === "starred") await library.selectStarred();
  if (panel === "sources") await library.selectInbox(false);
}

async function chooseCategory(categoryId: string | null) {
  activeSubpanel.value = "inbox";
  await library.selectCategory(categoryId);
}

async function chooseTag(tagId: string | null) {
  activeSubpanel.value = "inbox";
  await library.selectTag(tagId);
}

async function deleteFeed(feed: Feed) {
  const confirmed = window.confirm(`确定删除“${feed.title}”吗？\n该源下的文章也会一并删除。`);
  if (!confirmed) return;
  try {
    await library.deleteFeed(feed.id);
  } catch (cause) {
    library.error = String(cause);
  }
}

function clearFeedDialog() {
  showAddFeed.value = false;
  newFeedUrl.value = "";
  feedPreview.value = null;
  feedMessage.value = "";
  newFeedCategory.value = null;
  newFeedTags.value = [];
}

function openAddFeed(categoryId: string | null = null) {
  newFeedCategory.value = categoryId;
  newFeedTags.value = [];
  feedPreview.value = null;
  feedMessage.value = "";
  showAddFeed.value = true;
}

function openCreateCategory(target: CreateCategoryTarget) {
  createCategoryTarget.value = target;
  editingCategoryId.value = null;
  newCategoryName.value = "";
  newCategoryIcon.value = "◫";
  createMessage.value = "";
  showCreateCategory.value = true;
}

function openEditCategory(category: Category) {
  createCategoryTarget.value = "source";
  editingCategoryId.value = category.id;
  newCategoryName.value = category.name;
  newCategoryIcon.value = category.icon;
  createMessage.value = "";
  showCreateCategory.value = true;
}

async function previewFeed() {
  feedMessage.value = "";
  feedBusy.value = true;
  try {
    feedPreview.value = await validateFeed(newFeedUrl.value);
  } catch (cause) {
    feedMessage.value = String(cause);
  } finally {
    feedBusy.value = false;
  }
}

async function saveNewCategory() {
  const name = newCategoryName.value.trim();
  if (!name) {
    createMessage.value = "请输入分类名称";
    return;
  }
  try {
    const icon = newCategoryIcon.value.trim().slice(0, 2) || "◫";
    const category = editingCategoryId.value
      ? await library.updateCategory(editingCategoryId.value, name, "#8b5cf6", icon)
      : await library.createCategory(name, "#8b5cf6", icon);
    if (!editingCategoryId.value && createCategoryTarget.value === "feed") feedCategoryDraft.value = category.id;
    if (!editingCategoryId.value && createCategoryTarget.value === "article") articleCategoryDraft.value = category.id;
    if (!editingCategoryId.value && createCategoryTarget.value === "new-feed") newFeedCategory.value = category.id;
    showCreateCategory.value = false;
  } catch (cause) {
    createMessage.value = String(cause);
  }
}

function openCreateTag(target: CreateTagTarget) {
  createTagTarget.value = target;
  newTagName.value = "";
  createMessage.value = "";
  showCreateTag.value = true;
}

async function saveNewTag() {
  const name = newTagName.value.trim();
  if (!name) {
    createMessage.value = "请输入标签名称";
    return;
  }
  try {
    const tag = await library.createTag(name);
    if (createTagTarget.value === "feed") feedTagsDraft.value = [...feedTagsDraft.value, tag.id];
    if (createTagTarget.value === "article") articleTagsDraft.value = [...articleTagsDraft.value, tag.id];
    if (createTagTarget.value === "new-feed") newFeedTags.value = [...newFeedTags.value, tag.id];
    showCreateTag.value = false;
  } catch (cause) {
    createMessage.value = String(cause);
  }
}

function editFeed(feed: Feed) {
  organizationFeed.value = feed;
  feedCategoryDraft.value = feed.category_id ?? null;
  feedTagsDraft.value = [...feed.tag_ids];
  feedMessage.value = "";
  showFeedOrganization.value = true;
}

async function saveFeedOrganization() {
  if (!organizationFeed.value) return;
  feedBusy.value = true;
  try {
    await library.setFeedOrganization(organizationFeed.value.id, feedCategoryDraft.value, feedTagsDraft.value);
    showFeedOrganization.value = false;
  } catch (cause) {
    feedMessage.value = String(cause);
  } finally {
    feedBusy.value = false;
  }
}

function editArticleOrganization() {
  const article = library.selectedArticle;
  if (!article) return;
  articleCategoryDraft.value = article.category_id ?? null;
  articleTagsDraft.value = article.tags.map((name) => library.tags.find((tag) => tag.name === name)?.id).filter((id): id is string => Boolean(id));
  feedMessage.value = "";
  showArticleOrganization.value = true;
}

async function saveArticleOrganization() {
  if (!library.selectedArticle) return;
  feedBusy.value = true;
  try {
    await library.setArticleOrganization(library.selectedArticle.id, articleCategoryDraft.value, articleTagsDraft.value);
    showArticleOrganization.value = false;
  } catch (cause) {
    feedMessage.value = String(cause);
  } finally {
    feedBusy.value = false;
  }
}

async function submitFeed() {
  feedBusy.value = true;
  feedMessage.value = "";
  try {
    await library.addFeed(newFeedUrl.value, newFeedCategory.value, newFeedTags.value);
    clearFeedDialog();
  } catch (cause) {
    feedMessage.value = String(cause);
  } finally {
    feedBusy.value = false;
  }
}

function toggleAnalysis(id: string) {
  analysisSelection.value = toggleSelection(analysisSelection.value, id);
}

async function runTask(task: AiTask) {
  const ids = task === "cross-analysis" ? analysisSelection.value : library.selectedArticle ? [library.selectedArticle.id] : [];
  if (!ids.length) return;
  aiBusy.value = true;
  aiTask.value = task;
  aiResult.value = "正在分析…";
  try {
    const result = await runAiTask(task, ids);
    aiResult.value = result.content;
  } catch (cause) {
    aiResult.value = `请求失败：${String(cause)}`;
  } finally {
    aiBusy.value = false;
  }
}

async function handleAgentRun(prompt: string) {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt || agentBusy.value) return;
  if (!activeAgentSession.value) createAgentSession();
  const session = activeAgentSession.value;
  if (!session) return;

  agentBusy.value = true;
  const now = new Date().toISOString();
  const userMessage: AgentHistoryMessage = { id: crypto.randomUUID(), role: "user", content: cleanPrompt, createdAt: now };
  const assistantMessage: AgentHistoryMessage = { id: crypto.randomUUID(), role: "assistant", content: "", createdAt: new Date().toISOString() };
  session.messages.push(userMessage, assistantMessage);
  session.title = session.title === "新对话" ? cleanPrompt.slice(0, 32) : session.title;
  session.preview = cleanPrompt;
  session.updatedAt = now;
  agentPrompt.value = "";
  persistAgentHistory();

  try {
    if (!session.backendSessionId) {
      const backendSession = await startAgentSession();
      session.backendSessionId = backendSession.id;
    }
    const backendSessionId = session.backendSessionId;
    await runAgentRuntime({
      sessionId: backendSessionId,
      prompt: cleanPrompt,
      bootstrapHistory: session.messages.slice(0, -2).map((message) => ({ role: message.role, content: message.content, createdAt: message.createdAt })),
      onEvent: (event: AgentEvent) => {
        if (event.type === "assistant_delta") assistantMessage.content += event.delta;
        if (event.type === "output") assistantMessage.content = renderAgentOutputBlocks(event.blocks);
        if (event.type === "error") assistantMessage.content = `Agent 暂不可用：${event.message}`;
      },
    });
    if (!assistantMessage.content) assistantMessage.content = "没有找到可以直接回答的文章，换一个关键词试试。";
  } catch (cause) {
    if (!assistantMessage.content) assistantMessage.content = `Agent 暂不可用：${String(cause)}`;
  } finally {
    session.preview = assistantMessage.content.replace(/[#*_`>\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 96) || cleanPrompt;
    session.updatedAt = new Date().toISOString();
    persistAgentHistory();
    agentBusy.value = false;
  }
}

async function saveSettings() {
  await saveProviderConfig(providerDraft.value, providerApiKey.value);
  providerApiKey.value = "";
}

async function openOriginal() {
  if (library.selectedArticle) await openUrl(library.selectedArticle.url);
}

</script>

<template>
  <NConfigProvider>
    <main class="app-shell" :class="`skin-${skin}`">
      <WindowTitlebar />
      <section class="app-body" :class="`panel-${activePanel}`">
        <ActivityBar :active-panel="activePanel" @select="choosePanel" />
        <AiHistorySidebar v-if="activePanel === 'ai'" :sessions="agentSessions" :active-session-id="activeAgentSessionId" @select="selectAgentSession" @create="createAgentSession" @create-group="createAgentGroup" />
        <SecondaryNav v-else-if="activePanel !== 'settings' && activePanel !== 'home'" :active-panel="activePanel" :active-subpanel="activeSubpanel" :feeds="library.feeds" :categories="library.categories" :tags="library.tags" :selected-feed-id="library.selectedFeedId" :selected-category-id="library.selectedCategoryId" :selected-tag-id="library.selectedTagId" :total-unread="library.totalUnread" :analysis-count="analysisSelection.length" :articles="library.articles" :selected-article-id="library.selectedArticle?.id ?? null" :analysis-selection="analysisSelection" :loading="library.loading" :error="library.error" :search-query="library.searchQuery" @select-subpanel="chooseSubpanel" @select-feed="library.selectFeed" @select-category="chooseCategory" @select-tag="chooseTag" @edit-feed="editFeed" @delete-feed="deleteFeed" @edit-category="openEditCategory" @add-feed="openAddFeed" @add-category="openCreateCategory('source')" @open-article="library.openArticle" @toggle-analysis="toggleAnalysis" @toggle-starred="library.toggleStarred" @update-search="library.searchQuery = $event" @reload-search="library.loadArticles" />

        <SettingsWorkspace v-if="activePanel === 'settings'" v-model:skin="skin" v-model:provider-draft="providerDraft" v-model:provider-api-key="providerApiKey" :skin-options="skinOptions" :feed-count="library.feeds.length" :article-count="library.articles.length" @select-skin="setSkin" @save="saveSettings" />
        <ReadingWorkspace v-else-if="activePanel === 'reading'" :categories="library.categories" :selected-article="library.selectedArticle" :ai-result="aiResult" :ai-busy="aiBusy" :ai-task="aiTask" :analysis-count="analysisSelection.length" @toggle-starred="library.toggleStarred" @open-original="openOriginal" @edit-organization="editArticleOrganization" @load-content="library.loadFullContent" @run-task="runTask" />
        <OverlayScrollArea v-else-if="activePanel === 'ai'" class="ai-workspace-scroll"><AiWorkspace :session-title="activeAgentSession?.title || '新的研究任务'" :messages="activeAgentSession?.messages || []" :agent-prompt="agentPrompt" :agent-busy="agentBusy" @update:agent-prompt="agentPrompt = $event" @run-agent="handleAgentRun" @new-session="createAgentSession" /></OverlayScrollArea>
        <HomeWorkspace v-else-if="activePanel === 'home'" :total-unread="library.totalUnread" :feed-count="library.feeds.length" :article-count="library.articles.length" @open-reading="choosePanel('reading')" @open-sources="choosePanel('sources')" @sync="library.sync" />
        <SourceWorkspace v-else :feed="selectedFeed" :categories="library.categories" :tags="library.tags" @add-feed="openAddFeed" @edit-feed="editFeed" @delete-feed="deleteFeed" @open-reading="choosePanel('reading')" />
      </section>

      <LibraryModals v-model:show-add-feed="showAddFeed" v-model:new-feed-url="newFeedUrl" v-model:new-feed-category="newFeedCategory" v-model:new-feed-tags="newFeedTags" v-model:show-feed-organization="showFeedOrganization" v-model:feed-category-draft="feedCategoryDraft" v-model:feed-tags-draft="feedTagsDraft" v-model:show-article-organization="showArticleOrganization" v-model:article-category-draft="articleCategoryDraft" v-model:article-tags-draft="articleTagsDraft" v-model:show-create-category="showCreateCategory" v-model:new-category-name="newCategoryName" v-model:new-category-icon="newCategoryIcon" v-model:show-create-tag="showCreateTag" v-model:new-tag-name="newTagName" :categories="library.categories" :tags="library.tags" :feed-preview="feedPreview" :new-feed-category-name="newFeedCategoryName" :organization-feed="organizationFeed" :organization-feed-tag-names="organizationFeedTagNames" :feed-busy="feedBusy" :feed-message="feedMessage" :create-message="createMessage" :category-create-target="createCategoryTarget" :category-editing-id="editingCategoryId" @clear-feed="clearFeedDialog" @preview-feed="previewFeed" @submit-feed="submitFeed" @create-category="openCreateCategory" @create-tag="openCreateTag" @save-category="saveNewCategory" @save-tag="saveNewTag" @save-feed-organization="saveFeedOrganization" @save-article-organization="saveArticleOrganization" />
    </main>
  </NConfigProvider>
</template>
