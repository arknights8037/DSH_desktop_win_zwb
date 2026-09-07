<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

const viewport = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(1);
const contentHeight = ref(1);
const dragging = ref(false);
let resizeObserver: ResizeObserver | null = null;

const overflow = computed(() => Math.max(0, contentHeight.value - viewportHeight.value));
const thumbHeight = computed(() => overflow.value ? Math.max(32, (viewportHeight.value / contentHeight.value) * viewportHeight.value) : viewportHeight.value);
const thumbTop = computed(() => overflow.value ? (scrollTop.value / overflow.value) * (viewportHeight.value - thumbHeight.value) : 0);
const visible = computed(() => overflow.value > 2);

function syncMetrics() {
  const element = viewport.value;
  if (!element) return;
  viewportHeight.value = element.clientHeight;
  contentHeight.value = element.scrollHeight;
  scrollTop.value = element.scrollTop;
}

function onScroll() {
  scrollTop.value = viewport.value?.scrollTop ?? 0;
}

function scrollFromPointer(event: PointerEvent) {
  const element = viewport.value;
  const track = event.currentTarget as HTMLElement;
  if (!element || !track || !overflow.value) return;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top - thumbHeight.value / 2) / Math.max(1, rect.height - thumbHeight.value)));
  element.scrollTop = ratio * overflow.value;
}

function startThumbDrag(event: PointerEvent) {
  const element = viewport.value;
  if (!element) return;
  dragging.value = true;
  const startY = event.clientY;
  const startScroll = element.scrollTop;
  const trackHeight = viewportHeight.value;
  const onMove = (move: PointerEvent) => {
    element.scrollTop = startScroll + ((move.clientY - startY) / Math.max(1, trackHeight - thumbHeight.value)) * overflow.value;
  };
  const onEnd = () => {
    dragging.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
}

onMounted(async () => {
  await nextTick();
  syncMetrics();
  if (viewport.value) {
    resizeObserver = new ResizeObserver(syncMetrics);
    resizeObserver.observe(viewport.value);
    if (viewport.value.firstElementChild) resizeObserver.observe(viewport.value.firstElementChild);
  }
  window.addEventListener("resize", syncMetrics);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("resize", syncMetrics);
});
</script>

<template>
  <div class="overlay-scroll-area">
    <div ref="viewport" class="overlay-scroll-viewport" @scroll="onScroll">
      <slot />
    </div>
    <div v-if="visible" class="overlay-scroll-track" @pointerdown="scrollFromPointer">
      <div class="overlay-scroll-thumb" :class="{ dragging }" :style="{ height: `${thumbHeight}px`, transform: `translateY(${thumbTop}px)` }" @pointerdown.stop="startThumbDrag" />
    </div>
  </div>
</template>
