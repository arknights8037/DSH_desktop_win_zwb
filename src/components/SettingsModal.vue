<script setup lang="ts">
import { NButton, NModal } from "naive-ui";
import type { ProviderConfig } from "../types";

defineProps<{
  skinOptions: Array<{ id: string; label: string; note: string }>;
}>();

const show = defineModel<boolean>("show", { required: true });
const skin = defineModel<string>("skin", { required: true });
const providerDraft = defineModel<ProviderConfig>("providerDraft", { required: true });
const providerApiKey = defineModel<string>("providerApiKey", { required: true });
const emit = defineEmits<{ save: []; selectSkin: [skin: string] }>();
</script>

<template>
  <NModal v-model:show="show" preset="card" title="设置" style="width: 560px"><div class="modal-stack"><section><div class="settings-section-title">外观皮肤</div><div class="skin-grid"><button v-for="option in skinOptions" :key="option.id" class="skin-option" :class="{ selected: skin === option.id }" @click="emit('selectSkin', option.id)"><span :class="`skin-preview ${option.id}`" /><strong>{{ option.label }}</strong><small>{{ option.note }}</small></button></div></section><section><div class="settings-section-title">Responses API</div><label>Base URL<input v-model="providerDraft.base_url" /></label><label>模型<input v-model="providerDraft.model" placeholder="gpt-4o-mini" /></label><label>API Key<input v-model="providerApiKey" type="password" placeholder="留空表示保持已保存密钥" /></label><label>Key 引用<input v-model="providerDraft.api_key_ref" /></label><label>超时（毫秒）<input v-model.number="providerDraft.timeout_ms" type="number" /></label></section><div class="modal-actions"><NButton @click="show = false">取消</NButton><NButton type="primary" @click="emit('save')">保存设置</NButton></div></div></NModal>
</template>
