export type ShortcutId = "openSettings" | "goHome" | "goReading" | "goAi" | "goSources" | "sync";

export type ShortcutMap = Record<ShortcutId, string>;

export interface ShortcutDefinition {
  id: ShortcutId;
  label: string;
  description: string;
  defaultShortcut: string;
}

export const shortcutDefinitions: ShortcutDefinition[] = [
  { id: "openSettings", label: "打开设置", description: "进入设置工作区", defaultShortcut: "Mod+," },
  { id: "goHome", label: "首页概览", description: "切换到今日阅读概览", defaultShortcut: "Mod+1" },
  { id: "goReading", label: "阅读工作区", description: "打开未读文章列表", defaultShortcut: "Mod+2" },
  { id: "goAi", label: "AI 工作区", description: "打开 AI 阅读与分析", defaultShortcut: "Mod+3" },
  { id: "goSources", label: "订阅源", description: "打开源管理工作区", defaultShortcut: "Mod+4" },
  { id: "sync", label: "同步订阅", description: "刷新所有 RSS 订阅源", defaultShortcut: "Mod+R" },
];

export const defaultShortcuts: ShortcutMap = Object.fromEntries(shortcutDefinitions.map((item) => [item.id, item.defaultShortcut])) as ShortcutMap;

export function readStoredShortcuts(): ShortcutMap {
  const raw = localStorage.getItem("ai4rss-shortcuts");
  if (!raw) return { ...defaultShortcuts };
  try {
    return { ...defaultShortcuts, ...JSON.parse(raw) };
  } catch {
    return { ...defaultShortcuts };
  }
}

export function writeStoredShortcuts(shortcuts: ShortcutMap) {
  localStorage.setItem("ai4rss-shortcuts", JSON.stringify(shortcuts));
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const modifiers: string[] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push("Mod");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (["Control", "Meta", "Alt", "Shift"].includes(key)) return null;
  return [...modifiers, key].join("+");
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1];
  if (!key) return false;
  const needsMod = parts.includes("Mod");
  const needsAlt = parts.includes("Alt");
  const needsShift = parts.includes("Shift");
  const hasMod = event.metaKey || event.ctrlKey;
  const eventKey = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return hasMod === needsMod && event.altKey === needsAlt && event.shiftKey === needsShift && eventKey === key;
}

export function formatShortcut(shortcut: string) {
  return shortcut.replace("Mod", "⌘ / Ctrl").split("+").join("  ·  ");
}
