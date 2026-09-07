export interface CustomPalette {
  name: string;
  accent: string;
  accentSoft: string;
  canvas: string;
  activity: string;
  explorer: string;
  list: string;
  reader: string;
  panel: string;
  panel2: string;
  line: string;
  muted: string;
  text: string;
  radius: "sharp" | "soft" | "round";
  contentWidth: "narrow" | "standard" | "wide";
}

export const defaultCustomPalette: CustomPalette = {
  name: "我的色组",
  accent: "#62d9c2",
  accentSoft: "#183d3d",
  canvas: "#0c1718",
  activity: "#081112",
  explorer: "#0e2020",
  list: "#122626",
  reader: "#193131",
  panel: "#102021",
  panel2: "#153030",
  line: "#2c5a58",
  muted: "#8eadaa",
  text: "#e8faf5",
  radius: "soft",
  contentWidth: "standard",
};

function contrastingText(hex: string) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#fff";
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  return luminance > .55 ? "#1a1720" : "#fff";
}

export function readStoredCustomPalette(): CustomPalette {
  const raw = localStorage.getItem("ai4rss-custom-palette");
  if (!raw) return { ...defaultCustomPalette };
  try {
    return { ...defaultCustomPalette, ...JSON.parse(raw) };
  } catch {
    return { ...defaultCustomPalette };
  }
}

export function applyCustomPalette(palette: CustomPalette) {
  const root = document.documentElement;
  const radius = palette.radius === "sharp" ? ["2px", "4px"] : palette.radius === "round" ? ["9px", "14px"] : ["5px", "8px"];
  const width = palette.contentWidth === "narrow" ? "72%" : palette.contentWidth === "wide" ? "94%" : "82%";
  const vars: Record<string, string> = {
    "--accent": palette.accent,
    "--accent-soft": palette.accentSoft,
    "--canvas": palette.canvas,
    "--line": palette.line,
    "--muted": palette.muted,
    "--text": palette.text,
    "--accent-ink": contrastingText(palette.accent),
    "--radius-sm": radius[0],
    "--radius-md": radius[1],
    "--custom-accent": palette.accent,
    "--custom-accent-soft": palette.accentSoft,
    "--custom-canvas": palette.canvas,
    "--custom-activity": palette.activity,
    "--custom-explorer": palette.explorer,
    "--custom-list": palette.list,
    "--custom-reader": palette.reader,
    "--custom-panel": palette.panel,
    "--custom-panel-2": palette.panel2,
    "--custom-line": palette.line,
    "--custom-muted": palette.muted,
    "--custom-text": palette.text,
    "--custom-radius-sm": radius[0],
    "--custom-radius-md": radius[1],
    "--reader-content-width": width,
    "--modal-canvas": palette.panel,
    "--modal-canvas-2": palette.panel2,
    "--modal-line": palette.line,
    "--modal-text": palette.text,
    "--modal-muted": palette.muted,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.palette = "custom";
  localStorage.setItem("ai4rss-custom-palette", JSON.stringify(palette));
}

export function clearCustomPalette() {
  const root = document.documentElement;
  delete root.dataset.palette;
  ["--accent", "--accent-soft", "--canvas", "--line", "--muted", "--text", "--radius-sm", "--radius-md", "--custom-accent", "--custom-accent-soft", "--custom-canvas", "--custom-activity", "--custom-explorer", "--custom-list", "--custom-reader", "--custom-panel", "--custom-panel-2", "--custom-line", "--custom-muted", "--custom-text", "--custom-radius-sm", "--custom-radius-md", "--reader-content-width", "--modal-canvas", "--modal-canvas-2", "--modal-line", "--modal-text", "--modal-muted"].forEach((name) => root.style.removeProperty(name));
}
