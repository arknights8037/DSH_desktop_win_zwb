<script setup lang="ts">
import { NButton, NInput, NModal } from "naive-ui";
import type { Category, Feed, Tag } from "../types";

defineProps<{
  categories: Category[];
  tags: Tag[];
  feedPreview: { title: string; description?: string | null; item_count: number } | null;
  newFeedCategoryName: string;
  organizationFeed: Feed | null;
  organizationFeedTagNames: string[];
  feedBusy: boolean;
  feedMessage: string;
  createMessage: string;
  categoryCreateTarget: "feed" | "article" | "new-feed" | "source";
  categoryEditingId: string | null;
}>();

const showAddFeed = defineModel<boolean>("showAddFeed", { required: true });
const newFeedUrl = defineModel<string>("newFeedUrl", { required: true });
const newFeedCategory = defineModel<string | null>("newFeedCategory", { required: true });
const newFeedTags = defineModel<string[]>("newFeedTags", { required: true });
const showFeedOrganization = defineModel<boolean>("showFeedOrganization", { required: true });
const feedCategoryDraft = defineModel<string | null>("feedCategoryDraft", { required: true });
const feedTagsDraft = defineModel<string[]>("feedTagsDraft", { required: true });
const showArticleOrganization = defineModel<boolean>("showArticleOrganization", { required: true });
const articleCategoryDraft = defineModel<string | null>("articleCategoryDraft", { required: true });
const articleTagsDraft = defineModel<string[]>("articleTagsDraft", { required: true });
const showCreateCategory = defineModel<boolean>("showCreateCategory", { required: true });
const newCategoryName = defineModel<string>("newCategoryName", { required: true });
const newCategoryIcon = defineModel<string>("newCategoryIcon", { required: true });
const showCreateTag = defineModel<boolean>("showCreateTag", { required: true });
const newTagName = defineModel<string>("newTagName", { required: true });

const emit = defineEmits<{
  clearFeed: [];
  previewFeed: [];
  submitFeed: [];
  createCategory: [target: "feed" | "article" | "new-feed" | "source"];
  createTag: [target: "feed" | "article" | "new-feed"];
  saveCategory: [];
  saveTag: [];
  saveFeedOrganization: [];
  saveArticleOrganization: [];
}>();
</script>

<template>
  <NModal v-model:show="showAddFeed" preset="card" :title="newFeedCategoryName ? '添加源 · ' + newFeedCategoryName : '添加 RSS 订阅'" style="width: 520px" :mask-closable="false"><div class="modal-stack"><NInput v-model:value="newFeedUrl" placeholder="https://example.com/feed.xml" @keyup.enter="emit('previewFeed')" /><div class="modal-options"><label>分类<select v-model="newFeedCategory"><option :value="null">不指定分类</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select><button class="inline-create" @click="emit('createCategory', 'new-feed')">＋ 新建分类</button></label><label>标签<select v-model="newFeedTags" multiple><option v-for="tag in tags" :key="tag.id" :value="tag.id"># {{ tag.name }}</option></select><button class="inline-create" @click="emit('createTag', 'new-feed')">＋ 新建标签</button></label></div><div v-if="feedPreview" class="preview-card"><b>{{ feedPreview.title }}</b><span>{{ feedPreview.item_count }} 条近期文章</span></div><div v-if="feedMessage" class="error-banner">{{ feedMessage }}</div><div class="modal-actions"><NButton @click="emit('clearFeed')">取消</NButton><NButton secondary :loading="feedBusy" @click="emit('previewFeed')">验证地址</NButton><NButton type="primary" :disabled="!feedPreview" :loading="feedBusy" @click="emit('submitFeed')">保存订阅</NButton></div></div></NModal>

  <NModal v-model:show="showFeedOrganization" preset="card" :title="organizationFeed?.title || '源组织'" style="width: 480px"><div class="modal-stack"><div class="modal-options"><label>分类<select v-model="feedCategoryDraft"><option :value="null">不指定分类</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select><button class="inline-create" @click="emit('createCategory', 'feed')">＋ 新建分类</button></label><label>标签<select v-model="feedTagsDraft" multiple><option v-for="tag in tags" :key="tag.id" :value="tag.id"># {{ tag.name }}</option></select><button class="inline-create" @click="emit('createTag', 'feed')">＋ 新建标签</button></label></div><div v-if="organizationFeedTagNames.length" class="selection-note">{{ organizationFeedTagNames.join("、") }}</div><div v-if="feedMessage" class="error-banner">{{ feedMessage }}</div><div class="modal-actions"><NButton @click="showFeedOrganization = false">取消</NButton><NButton type="primary" :loading="feedBusy" @click="emit('saveFeedOrganization')">保存</NButton></div></div></NModal>

  <NModal v-model:show="showArticleOrganization" preset="card" title="文章组织" style="width: 480px"><div class="modal-stack"><div class="modal-options"><label>分类<select v-model="articleCategoryDraft"><option :value="null">继承源分类</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select><button class="inline-create" @click="emit('createCategory', 'article')">＋ 新建分类</button></label><label>标签<select v-model="articleTagsDraft" multiple><option v-for="tag in tags" :key="tag.id" :value="tag.id"># {{ tag.name }}</option></select><button class="inline-create" @click="emit('createTag', 'article')">＋ 新建标签</button></label></div><div v-if="feedMessage" class="error-banner">{{ feedMessage }}</div><div class="modal-actions"><NButton @click="showArticleOrganization = false">取消</NButton><NButton type="primary" :loading="feedBusy" @click="emit('saveArticleOrganization')">保存</NButton></div></div></NModal>

  <NModal v-model:show="showCreateCategory" preset="card" :title="categoryEditingId ? '编辑分类' : categoryCreateTarget === 'source' ? '添加分类' : '新建分类'" style="width: 380px" :mask-closable="false"><div class="modal-stack"><label>名称<NInput v-model:value="newCategoryName" placeholder="例如：科技、商业、设计" @keyup.enter="emit('saveCategory')" /></label><label>图标<NInput v-model:value="newCategoryIcon" placeholder="输入一个 emoji 或符号" maxlength="2" @keyup.enter="emit('saveCategory')" /></label><div class="category-icon-hint"><span :style="{ color: 'var(--accent)' }">{{ newCategoryIcon || "◫" }}</span><span>分类会显示在左侧源树中</span></div><div v-if="createMessage" class="error-banner">{{ createMessage }}</div><div class="modal-actions"><NButton @click="showCreateCategory = false">取消</NButton><NButton type="primary" @click="emit('saveCategory')">{{ categoryEditingId ? "保存修改" : "添加分类" }}</NButton></div></div></NModal>

  <NModal v-model:show="showCreateTag" preset="card" title="添加标签" style="width: 380px" :mask-closable="false"><div class="modal-stack"><label>名称<NInput v-model:value="newTagName" placeholder="例如：AI、行业、待读" @keyup.enter="emit('saveTag')" /></label><div v-if="createMessage" class="error-banner">{{ createMessage }}</div><div class="modal-actions"><NButton @click="showCreateTag = false">取消</NButton><NButton type="primary" @click="emit('saveTag')">添加标签</NButton></div></div></NModal>
</template>
