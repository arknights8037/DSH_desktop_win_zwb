import { computed, ref } from "vue";
import { defineStore } from "pinia";
import * as api from "../services/tauri";
import type { Article, ArticleListItem, Category, Feed, Tag } from "../types";

export const useLibraryStore = defineStore("library", () => {
  const feeds = ref<Feed[]>([]);
  const categories = ref<Category[]>([]);
  const tags = ref<Tag[]>([]);
  const articles = ref<ArticleListItem[]>([]);
  const selectedArticle = ref<Article | null>(null);
  const selectedFeedId = ref<string | null>(null);
  const selectedCategoryId = ref<string | null>(null);
  const selectedTagId = ref<string | null>(null);
  const unreadOnly = ref(false);
  const starredOnly = ref(false);
  const searchQuery = ref("");
  const loading = ref(false);
  const syncing = ref(false);
  const error = ref("");

  const totalUnread = computed(() => feeds.value.reduce((total, feed) => total + feed.unread_count, 0));
  const activeLabel = computed(() => {
    if (starredOnly.value) return "收藏夹";
    if (selectedFeedId.value) return feeds.value.find((feed) => feed.id === selectedFeedId.value)?.title ?? "订阅源";
    if (selectedCategoryId.value) return categories.value.find((category) => category.id === selectedCategoryId.value)?.name ?? "分类";
    if (selectedTagId.value) return `#${tags.value.find((tag) => tag.id === selectedTagId.value)?.name ?? "标签"}`;
    return unreadOnly.value ? "未读文章" : "收件箱";
  });

  async function loadLibrary() {
    loading.value = true;
    error.value = "";
    try {
      [feeds.value, categories.value, tags.value] = await Promise.all([api.listFeeds(), api.listCategories(), api.listTags()]);
      await loadArticles();
    } catch (cause) {
      error.value = String(cause);
    } finally {
      loading.value = false;
    }
  }

  async function loadArticles() {
    articles.value = await api.listArticles({
      feed_id: selectedFeedId.value,
      category_id: selectedCategoryId.value,
      tag_id: selectedTagId.value,
      unread_only: unreadOnly.value,
      starred_only: starredOnly.value,
      query: searchQuery.value || null,
      limit: 150,
    });
  }

  function clearSelection() {
    selectedFeedId.value = null;
    selectedCategoryId.value = null;
    selectedTagId.value = null;
    starredOnly.value = false;
    unreadOnly.value = false;
  }

  async function selectFeed(id: string | null) {
    clearSelection();
    selectedFeedId.value = id;
    await loadArticles();
  }

  async function selectCategory(id: string | null) {
    clearSelection();
    selectedCategoryId.value = id;
    await loadArticles();
  }

  async function selectTag(id: string | null) {
    clearSelection();
    selectedTagId.value = id;
    await loadArticles();
  }

  async function selectInbox(unread = false) {
    clearSelection();
    unreadOnly.value = unread;
    await loadArticles();
  }

  async function selectStarred() {
    clearSelection();
    starredOnly.value = true;
    await loadArticles();
  }

  async function openArticle(id: string) {
    selectedArticle.value = await api.getArticle(id);
    if (!selectedArticle.value) return;
    if (!selectedArticle.value.is_read) {
      selectedArticle.value.is_read = true;
      const item = articles.value.find((article) => article.id === id);
      if (item) item.is_read = true;
      await api.updateArticleState(id, { isRead: true });
      const feed = feeds.value.find((value) => value.id === selectedArticle.value?.feed_id);
      if (feed) feed.unread_count = Math.max(0, feed.unread_count - 1);
    }
  }

  async function loadFullContent() {
    if (!selectedArticle.value) return;
    try {
      selectedArticle.value = await api.fetchArticleContent(selectedArticle.value.id);
    } catch (cause) {
      error.value = String(cause);
    }
  }

  async function toggleStarred(article: ArticleListItem | Article) {
    const next = !article.is_starred;
    article.is_starred = next;
    await api.updateArticleState(article.id, { isStarred: next });
    if (selectedArticle.value?.id === article.id) selectedArticle.value.is_starred = next;
  }

  async function sync() {
    syncing.value = true;
    error.value = "";
    try {
      await api.syncFeeds();
      await loadLibrary();
    } catch (cause) {
      error.value = String(cause);
    } finally {
      syncing.value = false;
    }
  }

  async function addFeed(url: string, categoryId: string | null, tagIds: string[]) {
    await api.addFeed(url, categoryId, tagIds);
    await loadLibrary();
  }

  async function deleteFeed(id: string) {
    await api.deleteFeed(id);
    if (selectedFeedId.value === id) selectedFeedId.value = null;
    if (selectedArticle.value?.feed_id === id) selectedArticle.value = null;
    await loadLibrary();
  }

  async function createCategory(name: string, color = "#8b5cf6", icon = "◫") {
    const created = await api.createCategory(name, color, icon);
    categories.value = await api.listCategories();
    return categories.value.find((category) => category.id === created.id) ?? created;
  }

  async function updateCategory(id: string, name: string, color = "#8b5cf6", icon = "◫") {
    const updated = await api.updateCategory(id, name, color, icon);
    categories.value = await api.listCategories();
    return categories.value.find((category) => category.id === updated.id) ?? updated;
  }

  async function createTag(name: string) {
    const created = await api.createTag(name);
    tags.value = await api.listTags();
    return tags.value.find((tag) => tag.id === created.id) ?? created;
  }

  async function setFeedOrganization(id: string, categoryId: string | null, tagIds: string[]) {
    await api.setFeedOrganization(id, categoryId, tagIds);
    await loadLibrary();
  }

  async function setArticleOrganization(id: string, categoryId: string | null, tagIds: string[]) {
    await api.setArticleOrganization(id, categoryId, tagIds);
    await loadArticles();
    await openArticle(id);
  }

  return {
    feeds, categories, tags, articles, selectedArticle, selectedFeedId, selectedCategoryId, selectedTagId,
    unreadOnly, starredOnly, searchQuery, loading, syncing, error, totalUnread, activeLabel,
    loadLibrary, loadArticles, selectFeed, selectCategory, selectTag, selectInbox, selectStarred,
    openArticle, loadFullContent, toggleStarred, sync, addFeed, deleteFeed, createCategory, createTag,
    setFeedOrganization, setArticleOrganization, updateCategory,
  };
});
