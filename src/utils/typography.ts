export interface TypographyPreferences {
  uiFont: string;
  readingFont: string;
  bodyFontSize: number;
  uiFontSize: number;
  titleFontSize: number;
  metaFontSize: number;
  lineHeight: number;
}

export const defaultTypographyPreferences: TypographyPreferences = {
  uiFont: "Inter",
  readingFont: "Georgia",
  bodyFontSize: 17,
  uiFontSize: 12,
  titleFontSize: 48,
  metaFontSize: 10,
  lineHeight: 1.85,
};

function safeFontName(value: string) {
  return value.replace(/["']/g, "").trim() || "Inter";
}

export function applyTypographyPreferences(preferences: Partial<TypographyPreferences>) {
  const value = { ...defaultTypographyPreferences, ...preferences };
  const root = document.documentElement;
  const uiFont = safeFontName(value.uiFont);
  const readingFont = safeFontName(value.readingFont);
  root.style.setProperty("--app-font-family", `"${uiFont}", Inter, ui-sans-serif, system-ui, sans-serif`);
  root.style.setProperty("--reading-font-family", `"${readingFont}", Georgia, "Songti SC", serif`);
  root.style.setProperty("--ui-font-size", `${value.uiFontSize}px`);
  root.style.setProperty("--body-font-size", `${value.bodyFontSize}px`);
  root.style.setProperty("--reader-title-size", `${value.titleFontSize}px`);
  root.style.setProperty("--meta-font-size", `${value.metaFontSize}px`);
  root.style.setProperty("--body-line-height", String(value.lineHeight));
}

export function readStoredTypographyPreferences(): Partial<TypographyPreferences> {
  const raw = localStorage.getItem("ai4rss-settings");
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Partial<TypographyPreferences>;
    return value;
  } catch {
    return {};
  }
}
