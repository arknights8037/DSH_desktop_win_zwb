<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { ProviderConfig } from "../types";
import OverlayScrollArea from "./OverlayScrollArea.vue";
import { applyTypographyPreferences, defaultTypographyPreferences } from "../utils/typography";
import { applyCustomPalette, defaultCustomPalette, readStoredCustomPalette, type CustomPalette } from "../utils/theme";
import { defaultShortcuts, formatShortcut, readStoredShortcuts, shortcutDefinitions, shortcutFromKeyboardEvent, writeStoredShortcuts, type ShortcutId, type ShortcutMap } from "../utils/shortcuts";

type SettingsSection = "overview" | "appearance" | "typography" | "style" | "shortcuts" | "ai" | "reading" | "data";

const props = defineProps<{
  skinOptions: Array<{ id: string; label: string; note: string }>;
  feedCount: number;
  articleCount: number;
}>();

const skin = defineModel<string>("skin", { required: true });
const providerDraft = defineModel<ProviderConfig>("providerDraft", { required: true });
const providerApiKey = defineModel<string>("providerApiKey", { required: true });
const emit = defineEmits<{ save: []; selectSkin: [skin: string] }>();

const activeSection = ref<SettingsSection>("overview");
const saveNotice = ref("");
const preferences = ref({
  ...defaultTypographyPreferences,
  startView: "home",
  density: "comfortable",
  markReadOnOpen: true,
  autoLoadContent: true,
  reducedMotion: false,
});

const sections: Array<{ id: SettingsSection; label: string; note: string; icon: string }> = [
  { id: "overview", label: "概览", note: "应用状态与快捷设置", icon: "⌂" },
  { id: "appearance", label: "外观", note: "皮肤、密度与动效", icon: "◐" },
  { id: "typography", label: "文字", note: "字体、字号与阅读排版", icon: "Aa" },
  { id: "style", label: "样式", note: "布局、圆角与自定义色组", icon: "◆" },
  { id: "shortcuts", label: "快捷键", note: "配置工作区操作方式", icon: "⌘" },
  { id: "ai", label: "AI 服务", note: "模型与 API 连接", icon: "✦" },
  { id: "reading", label: "阅读", note: "阅读行为与内容加载", icon: "▤" },
  { id: "data", label: "数据与隐私", note: "本地数据与缓存", icon: "⌁" },
];

const activeSectionMeta = computed(() => sections.find((section) => section.id === activeSection.value) ?? sections[0]);
const localFonts = ref(["Inter", "Segoe UI", "Arial", "Helvetica Neue", "Tahoma", "Verdana", "Georgia", "Times New Roman", "Songti SC", "Microsoft YaHei"]);
const fontStatus = ref("");
const fontFileInput = ref<HTMLInputElement | null>(null);
const customPalette = ref<CustomPalette>(readStoredCustomPalette());
const shortcuts = ref<ShortcutMap>(readStoredShortcuts());
const recordingShortcut = ref<ShortcutId | null>(null);
const shortcutMessage = ref("");

onMounted(() => {
  const raw = localStorage.getItem("ai4rss-settings");
  if (!raw) return;
  try {
    preferences.value = { ...preferences.value, ...JSON.parse(raw) };
    applyTypographyPreferences(preferences.value);
  } catch {
    localStorage.removeItem("ai4rss-settings");
  }
});

watch(preferences, (value) => {
  localStorage.setItem("ai4rss-settings", JSON.stringify(value));
  applyTypographyPreferences(value);
}, { deep: true });

watch(customPalette, (value) => {
  if (skin.value === "custom") applyCustomPalette(value);
}, { deep: true });

watch(shortcuts, (value) => {
  writeStoredShortcuts(value);
}, { deep: true });

onMounted(() => window.addEventListener("keydown", captureShortcut));
onUnmounted(() => {
  window.removeEventListener("keydown", captureShortcut);
  delete document.documentElement.dataset.shortcutRecording;
});

function captureShortcut(event: KeyboardEvent) {
  if (!recordingShortcut.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    cancelShortcutRecording();
    return;
  }
  const value = shortcutFromKeyboardEvent(event);
  if (!value || !value.includes("+")) {
    shortcutMessage.value = "请至少按下一个修饰键和字母、数字或功能键";
    return;
  }
  const conflict = Object.entries(shortcuts.value).find(([id, shortcut]) => id !== recordingShortcut.value && shortcut === value);
  if (conflict) {
    shortcutMessage.value = `与「${shortcutDefinitions.find((item) => item.id === conflict[0])?.label ?? conflict[0]}」冲突`;
    return;
  }
  shortcuts.value[recordingShortcut.value] = value;
  shortcutMessage.value = "快捷键已更新";
  cancelShortcutRecording(false);
}

function startShortcutRecording(id: ShortcutId) {
  recordingShortcut.value = id;
  shortcutMessage.value = "按下新的组合键，按 Esc 取消";
  document.documentElement.dataset.shortcutRecording = "true";
}

function cancelShortcutRecording(clearMessage = true) {
  recordingShortcut.value = null;
  delete document.documentElement.dataset.shortcutRecording;
  if (clearMessage) shortcutMessage.value = "";
}

function hasShortcutConflict(id: ShortcutId) {
  const shortcut = shortcuts.value[id];
  return Object.entries(shortcuts.value).some(([otherId, value]) => otherId !== id && value === shortcut);
}

async function scanLocalFonts() {
  const localFontApi = (window as Window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts;
  if (!localFontApi) {
    fontStatus.value = "当前运行环境不支持系统字体读取，已显示常用字体";
    return;
  }
  try {
    const fonts = await localFontApi();
    localFonts.value = [...new Set([...localFonts.value, ...fonts.map((font) => font.family)])].sort((a, b) => a.localeCompare(b));
    fontStatus.value = `已读取 ${fonts.length} 个本机字体`;
  } catch {
    fontStatus.value = "未获得字体读取权限，仍可使用下方字体文件导入";
  }
}

async function loadFontFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const family = `AI4RSS ${file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, "").replace(/["']/g, "").trim()}`;
  try {
    const fontFace = new FontFace(family, `url(${URL.createObjectURL(file)})`);
    await fontFace.load();
    document.fonts.add(fontFace);
    localFonts.value = [...new Set([family, ...localFonts.value])];
    preferences.value.readingFont = family;
    fontStatus.value = `${file.name} 已载入本次运行`;
  } catch {
    fontStatus.value = "字体文件读取失败，请选择有效的 TTF、OTF、WOFF 或 WOFF2 文件";
  } finally {
    input.value = "";
  }
}

function openFontFilePicker() {
  fontFileInput.value?.click();
}

function chooseSection(section: SettingsSection) {
  activeSection.value = section;
  saveNotice.value = "";
}

function chooseSkin(id: string) {
  emit("selectSkin", id);
}

function choosePalette(id: string) {
  if (id === "custom") {
    skin.value = "custom";
    applyCustomPalette(customPalette.value);
    emit("selectSkin", "custom");
    return;
  }
  emit("selectSkin", id);
}

function save() {
  localStorage.setItem("ai4rss-settings", JSON.stringify(preferences.value));
  writeStoredShortcuts(shortcuts.value);
  saveNotice.value = "设置已保存";
  emit("save");
  window.setTimeout(() => { saveNotice.value = ""; }, 2600);
}

function resetLocalPreferences() {
  preferences.value = {
    ...defaultTypographyPreferences,
    startView: "home",
    density: "comfortable",
    markReadOnOpen: true,
    autoLoadContent: true,
    reducedMotion: false,
  };
  customPalette.value = { ...defaultCustomPalette };
  shortcuts.value = { ...defaultShortcuts };
  saveNotice.value = "已恢复默认偏好";
}
</script>

<template>
  <section class="settings-page">
    <OverlayScrollArea>
      <div class="settings-page-inner">
        <header class="settings-page-header">
          <div>
            <span class="eyebrow">Workspace settings</span>
            <h1>设置</h1>
            <p>调整 AI4RSS 的外观、阅读体验与 AI 服务连接。</p>
          </div>
          <div class="settings-header-actions">
            <span v-if="saveNotice" class="settings-save-notice">{{ saveNotice }}</span>
            <button class="button button-primary" @click="save">保存更改</button>
          </div>
        </header>

        <div class="settings-layout">
          <aside class="settings-sidebar" aria-label="设置分类">
            <div class="settings-sidebar-label">Preferences</div>
            <button v-for="section in sections" :key="section.id" class="settings-nav-item" :class="{ selected: activeSection === section.id }" @click="chooseSection(section.id)">
              <span class="settings-nav-icon">{{ section.icon }}</span>
              <span><strong>{{ section.label }}</strong><small>{{ section.note }}</small></span>
              <span v-if="activeSection === section.id" class="settings-nav-dot" />
            </button>
            <div class="settings-sidebar-footer">
              <span class="status-dot" />本地配置已就绪
            </div>
          </aside>

          <main class="settings-content">
            <div class="settings-section-heading">
              <div><span class="settings-section-kicker">{{ activeSectionMeta.label }}</span><h2>{{ activeSectionMeta.note }}</h2></div>
              <span class="settings-section-index">0{{ sections.findIndex((section) => section.id === activeSection) + 1 }} / 08</span>
            </div>

            <div v-if="activeSection === 'overview'" class="settings-section-body">
              <section class="settings-hero-card">
                <div><span class="settings-card-label">AI4RSS READER</span><strong>让信息流变成<br /><em>可理解的知识。</em></strong><p>保持专注，留下真正值得回看的内容。</p></div>
                <div class="settings-hero-mark">✦</div>
              </section>
              <div class="settings-stat-grid">
                <div><span>订阅源</span><strong>{{ feedCount }}</strong><small>已连接的 RSS 源</small></div>
                <div><span>文章总数</span><strong>{{ articleCount }}</strong><small>本地索引内容</small></div>
                <div><span>当前皮肤</span><strong>{{ skin }}</strong><small>可在外观中切换</small></div>
              </div>
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">QUICK START</span><h3>启动与默认视图</h3></div><span class="settings-card-symbol">⌘</span></div>
                <div class="settings-form-grid">
                  <label class="settings-field"><span>启动时打开</span><select v-model="preferences.startView"><option value="home">首页概览</option><option value="reading">未读文章</option><option value="sources">订阅源</option></select></label>
                  <label class="settings-field"><span>列表密度</span><select v-model="preferences.density"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
                </div>
              </section>
            </div>

            <div v-else-if="activeSection === 'appearance'" class="settings-section-body">
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">THEME SYSTEM</span><h3>选择工作台皮肤</h3></div><span class="settings-card-symbol">◐</span></div>
                <p class="settings-card-description">皮肤会同时应用到工作区、输入控件和所有弹窗。</p>
                <div class="settings-skin-grid">
                  <button v-for="option in props.skinOptions" :key="option.id" class="settings-skin-option" :class="{ selected: skin === option.id }" @click="chooseSkin(option.id)">
                    <span :class="`settings-skin-preview ${option.id}`"><i /><i /><i /></span><span class="settings-skin-copy"><strong>{{ option.label }}</strong><small>{{ option.note }}</small></span><span class="settings-check">{{ skin === option.id ? "✓" : "" }}</span>
                  </button>
                </div>
              </section>
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">COMFORT</span><h3>显示偏好</h3></div><span class="settings-card-symbol">Aa</span></div>
                <div class="settings-form-grid"><label class="settings-field"><span>内容密度</span><select v-model="preferences.density"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label></div>
                <label class="settings-toggle"><span><strong>减少动效</strong><small>关闭悬停过渡与装饰性动效</small></span><input v-model="preferences.reducedMotion" type="checkbox" /><i /></label>
              </section>
            </div>

            <div v-else-if="activeSection === 'typography'" class="settings-section-body">
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">FONT LIBRARY</span><h3>字体来源</h3></div><span class="settings-card-symbol">Aa</span></div>
                <p class="settings-card-description">优先使用本机已安装字体；也可以临时导入电脑中的字体文件。</p>
                <div class="settings-form-grid">
                  <label class="settings-field settings-field-wide"><span>阅读字体</span><select v-model="preferences.readingFont"><option v-for="font in localFonts" :key="font" :value="font">{{ font }}</option></select></label>
                  <label class="settings-field settings-field-wide"><span>界面字体</span><select v-model="preferences.uiFont"><option v-for="font in localFonts" :key="`ui-${font}`" :value="font">{{ font }}</option></select></label>
                </div>
                <div class="settings-font-tools"><button class="button button-secondary" @click="scanLocalFonts">⌕ 读取本机字体</button><button class="button button-quiet" @click="openFontFilePicker">＋ 导入字体文件</button><input ref="fontFileInput" class="settings-font-file-input" type="file" accept=".ttf,.otf,.woff,.woff2" @change="loadFontFile" /></div>
                <p v-if="fontStatus" class="settings-font-status">{{ fontStatus }}</p>
              </section>
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">TYPE SCALE</span><h3>字号与阅读排版</h3></div><span class="settings-card-symbol">⌗</span></div>
                <div class="settings-form-grid">
                  <label class="settings-field"><span>正文大小</span><div class="settings-range-row"><input v-model.number="preferences.bodyFontSize" type="range" min="12" max="28" step="1" /><output>{{ preferences.bodyFontSize }} px</output></div></label>
                  <label class="settings-field"><span>界面文字</span><div class="settings-range-row"><input v-model.number="preferences.uiFontSize" type="range" min="10" max="18" step="1" /><output>{{ preferences.uiFontSize }} px</output></div></label>
                  <label class="settings-field"><span>文章标题</span><div class="settings-range-row"><input v-model.number="preferences.titleFontSize" type="range" min="28" max="72" step="1" /><output>{{ preferences.titleFontSize }} px</output></div></label>
                  <label class="settings-field"><span>辅助文字</span><div class="settings-range-row"><input v-model.number="preferences.metaFontSize" type="range" min="9" max="15" step="1" /><output>{{ preferences.metaFontSize }} px</output></div></label>
                  <label class="settings-field settings-field-wide"><span>正文行高</span><div class="settings-range-row"><input v-model.number="preferences.lineHeight" type="range" min="1.4" max="2.2" step="0.05" /><output>{{ preferences.lineHeight }}</output></div></label>
                </div>
                <div class="settings-type-preview"><span class="settings-preview-label">PREVIEW</span><h4>阅读是一种重新组织世界的方式</h4><p>这段文字会使用你选择的阅读字体、字号和行高。调整设置时可以即时观察排版变化。</p><small>AI4RSS · 文章元信息</small></div>
              </section>
            </div>

            <div v-else-if="activeSection === 'style'" class="settings-section-body">
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">COLOR GROUPS</span><h3>颜色组</h3></div><span class="settings-card-symbol">◆</span></div>
                <p class="settings-card-description">选择预设色组，或创建一套属于你的工作台颜色。颜色会同步到正文、控件和所有弹窗。</p>
                <div class="settings-palette-grid">
                  <button v-for="option in props.skinOptions" :key="option.id" class="settings-palette-option" :class="{ selected: skin === option.id }" @click="choosePalette(option.id)"><span :class="`settings-palette-swatch ${option.id}`"><i /><i /><i /></span><strong>{{ option.label }}</strong><small>{{ option.note }}</small><b>{{ skin === option.id ? "当前" : "" }}</b></button>
                  <button class="settings-palette-option" :class="{ selected: skin === 'custom' }" @click="choosePalette('custom')"><span class="settings-palette-swatch custom" :style="{ background: `linear-gradient(135deg, ${customPalette.canvas}, ${customPalette.accent})` }"><i /><i /><i /></span><strong>{{ customPalette.name || "我的色组" }}</strong><small>自定义颜色组</small><b>{{ skin === 'custom' ? "当前" : "" }}</b></button>
                </div>
              </section>
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">CUSTOM PALETTE</span><h3>编辑自定义颜色</h3></div><span class="settings-card-symbol">⌘</span></div>
                <div class="settings-form-grid">
                  <label class="settings-field settings-field-wide"><span>色组名称</span><input v-model="customPalette.name" placeholder="例如：森林夜读" /></label>
                  <label class="settings-color-field"><span>强调色</span><div><input v-model="customPalette.accent" type="color" /><code>{{ customPalette.accent }}</code></div></label>
                  <label class="settings-color-field"><span>强调背景</span><div><input v-model="customPalette.accentSoft" type="color" /><code>{{ customPalette.accentSoft }}</code></div></label>
                  <label class="settings-color-field"><span>工作台底色</span><div><input v-model="customPalette.canvas" type="color" /><code>{{ customPalette.canvas }}</code></div></label>
                  <label class="settings-color-field"><span>阅读区底色</span><div><input v-model="customPalette.reader" type="color" /><code>{{ customPalette.reader }}</code></div></label>
                  <label class="settings-color-field"><span>正文颜色</span><div><input v-model="customPalette.text" type="color" /><code>{{ customPalette.text }}</code></div></label>
                  <label class="settings-color-field"><span>辅助文字</span><div><input v-model="customPalette.muted" type="color" /><code>{{ customPalette.muted }}</code></div></label>
                  <label class="settings-color-field settings-field-wide"><span>分割线颜色</span><div><input v-model="customPalette.line" type="color" /><code>{{ customPalette.line }}</code></div></label>
                </div>
                <div class="settings-font-tools"><button class="button button-primary" @click="choosePalette('custom')">应用并保存色组</button><span class="settings-color-hint">颜色变化会在选择自定义色组后即时应用</span></div>
              </section>
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">LAYOUT LANGUAGE</span><h3>界面样式</h3></div><span class="settings-card-symbol">▦</span></div>
                <div class="settings-form-grid"><label class="settings-field"><span>圆角风格</span><select v-model="customPalette.radius"><option value="sharp">利落</option><option value="soft">柔和</option><option value="round">圆润</option></select></label><label class="settings-field"><span>阅读区宽度</span><select v-model="customPalette.contentWidth"><option value="narrow">窄</option><option value="standard">标准</option><option value="wide">宽</option></select></label></div>
              </section>
            </div>

            <div v-else-if="activeSection === 'shortcuts'" class="settings-section-body">
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">KEYBOARD SERVICE</span><h3>快捷键配置</h3></div><span class="settings-card-symbol">⌘</span></div>
                <p class="settings-card-description">点击右侧按键框后直接按下新的组合键。快捷键使用跨平台的 Mod 表示 Ctrl 或 Command。</p>
                <div class="shortcut-list">
                  <div v-for="item in shortcutDefinitions" :key="item.id" class="shortcut-row" :class="{ recording: recordingShortcut === item.id }">
                    <div><strong>{{ item.label }}</strong><small>{{ item.description }}</small></div>
                    <button class="shortcut-key" :class="{ conflict: hasShortcutConflict(item.id) }" @click="startShortcutRecording(item.id)">{{ recordingShortcut === item.id ? "按下组合键…" : formatShortcut(shortcuts[item.id]) }}</button>
                  </div>
                </div>
                <div v-if="shortcutMessage" class="settings-shortcut-message">{{ shortcutMessage }}</div>
                <div class="settings-font-tools"><button class="button button-quiet" @click="shortcuts = { ...defaultShortcuts }; shortcutMessage = '已恢复默认快捷键'">恢复默认快捷键</button><span class="settings-color-hint">冲突的快捷键会以红色标记</span></div>
              </section>
            </div>

            <div v-else-if="activeSection === 'ai'" class="settings-section-body">
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">OPENAI RESPONSES API</span><h3>连接 AI 服务</h3></div><span class="settings-connection-status"><i />已配置</span></div>
                <p class="settings-card-description">AI4RSS 使用 Responses API 执行摘要、翻译、可信度和交叉分析任务。</p>
                <div class="settings-form-grid">
                  <label class="settings-field settings-field-wide"><span>Base URL</span><input v-model="providerDraft.base_url" /></label>
                  <label class="settings-field"><span>模型</span><input v-model="providerDraft.model" placeholder="gpt-4o-mini" /></label>
                  <label class="settings-field"><span>超时（毫秒）</span><input v-model.number="providerDraft.timeout_ms" type="number" min="1000" step="1000" /></label>
                  <label class="settings-field settings-field-wide"><span>API Key</span><input v-model="providerApiKey" type="password" placeholder="留空表示保持已保存密钥" /></label>
                  <label class="settings-field settings-field-wide"><span>Key 引用</span><input v-model="providerDraft.api_key_ref" placeholder="default" /></label>
                </div>
              </section>
              <div class="settings-callout"><span>✦</span><p>密钥仅通过本地 Tauri 存储管理，不会写入文章内容或同步到 RSS 源。</p></div>
            </div>

            <div v-else-if="activeSection === 'reading'" class="settings-section-body">
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">READING FLOW</span><h3>阅读行为</h3></div><span class="settings-card-symbol">▤</span></div>
                <label class="settings-toggle"><span><strong>打开文章时标记已读</strong><small>进入阅读器后自动更新文章状态</small></span><input v-model="preferences.markReadOnOpen" type="checkbox" /><i /></label>
                <label class="settings-toggle"><span><strong>自动加载全文</strong><small>打开没有正文的文章时尝试提取内容</small></span><input v-model="preferences.autoLoadContent" type="checkbox" /><i /></label>
              </section>
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">DEFAULTS</span><h3>阅读器默认值</h3></div><span class="settings-card-symbol">⌗</span></div>
                <div class="settings-form-grid"><label class="settings-field"><span>默认打开视图</span><select v-model="preferences.startView"><option value="home">首页概览</option><option value="reading">未读文章</option><option value="sources">订阅源</option></select></label><label class="settings-field"><span>列表密度</span><select v-model="preferences.density"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label></div>
              </section>
            </div>

            <div v-else class="settings-section-body">
              <section class="settings-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">LOCAL DATA</span><h3>数据与隐私</h3></div><span class="settings-card-symbol">⌁</span></div>
                <div class="settings-data-row"><span><strong>文章与订阅数据</strong><small>由本地数据库管理，不会离开设备</small></span><span class="settings-data-value">{{ articleCount + feedCount }} 条记录</span></div>
                <div class="settings-data-row"><span><strong>偏好设置</strong><small>皮肤、阅读与显示选项</small></span><span class="settings-data-value">已同步</span></div>
              </section>
              <section class="settings-card settings-danger-card">
                <div class="settings-card-heading"><div><span class="settings-card-label">RESET</span><h3>恢复默认偏好</h3></div><span class="settings-card-symbol">!</span></div>
                <p class="settings-card-description">只会重置本页保存的阅读与显示偏好，不会删除订阅源、文章或 API 配置。</p>
                <button class="button settings-danger-button" @click="resetLocalPreferences">恢复默认</button>
              </section>
            </div>

            <footer class="settings-about"><span>AI4RSS v0.1.0</span><span>Local-first RSS workspace</span><span>⌘ , 打开设置</span></footer>
          </main>
        </div>
      </div>
    </OverlayScrollArea>
  </section>
</template>
