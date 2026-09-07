<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";

async function startDragging(event: MouseEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
  await invoke<void>("window_start_dragging");
}

async function minimize() {
  await invoke<void>("window_minimize");
}

async function toggleMaximize() {
  await invoke<void>("window_toggle_maximize");
}

async function closeWindow() {
  await invoke<void>("window_close");
}
</script>

<template>
  <header class="titlebar" data-tauri-drag-region @mousedown="startDragging">
    <div class="titlebar-mark">R/</div>
    <div class="titlebar-spacer" />
    <div class="window-controls">
      <button aria-label="最小化" title="最小化" @mousedown.stop @click.stop="minimize">—</button>
      <button aria-label="最大化" title="最大化" @mousedown.stop @click.stop="toggleMaximize">□</button>
      <button class="close-control" aria-label="关闭" title="关闭" @mousedown.stop @click.stop="closeWindow">×</button>
    </div>
  </header>
</template>
