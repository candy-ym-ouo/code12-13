<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, Link } from "@element-plus/icons-vue";
import { apiErrorMessage } from "@/api/client";
import { speciesApi } from "@/api";
import SpeciesCardPanel from "@/components/SpeciesCardView.vue";
import { useSiteStore } from "@/stores/site";
import { useSpeciesStore } from "@/stores/species";
import type { ShareLink, SpeciesCard } from "@/types/models";

const route = useRoute();
const router = useRouter();
const speciesStore = useSpeciesStore();
const siteStore = useSiteStore();

const speciesId = computed(() => String(route.params.id));
const card = ref<SpeciesCard | null>(null);
const loading = ref(true);
const error = ref("");

const scopeSiteId = ref<string>("");
const shareDialogVisible = ref(false);
const shareForm = ref({ expiresInDays: 30, siteScoped: false, siteId: "" });
const creating = ref(false);
const links = ref<ShareLink[]>([]);

async function loadCard() {
  loading.value = true;
  error.value = "";
  try {
    card.value = await speciesApi.card(speciesId.value, scopeSiteId.value ? { siteId: scopeSiteId.value } : {});
  } catch (err) {
    error.value = apiErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function openShareDialog() {
  shareForm.value = { expiresInDays: 30, siteScoped: false, siteId: scopeSiteId.value };
  shareDialogVisible.value = true;
  try {
    links.value = await speciesApi.listCardShares(speciesId.value, scopeSiteId.value ? { siteId: scopeSiteId.value } : {});
  } catch (err) {
    ElMessage.error(apiErrorMessage(err));
  }
}

async function createShare() {
  creating.value = true;
  try {
    const link = await speciesApi.createCardShare(speciesId.value, {
      scope: "SPECIES_CARD",
      siteId: shareForm.value.siteScoped && shareForm.value.siteId ? shareForm.value.siteId : null,
      expiresInDays: shareForm.value.expiresInDays,
    });
    links.value = [link, ...links.value];
    await navigator.clipboard?.writeText(link.url).catch(() => undefined);
    ElMessage.success("只读链接已生成并复制到剪贴板");
  } catch (err) {
    ElMessage.error(apiErrorMessage(err));
  } finally {
    creating.value = false;
  }
}

async function copyLink(link: ShareLink) {
  await navigator.clipboard?.writeText(link.url).catch(() => undefined);
  ElMessage.success("链接已复制");
}

async function revoke(link: ShareLink) {
  try {
    await ElMessageBox.confirm("撤销后，持有该链接的人将无法再查看资料卡。", "撤销只读链接", { type: "warning" });
    await speciesApi.revokeCardShare(speciesId.value, link.id);
    links.value = links.value.filter((item) => item.id !== link.id);
    ElMessage.success("链接已撤销");
  } catch (err) {
    if (err !== "cancel") ElMessage.error(apiErrorMessage(err));
  }
}

onMounted(async () => {
  await Promise.all([speciesStore.fetch(), siteStore.fetch()]);
  await loadCard();
});
</script>

<template>
  <div class="page page--wide">
    <header class="page-header">
      <div class="page-header__back">
        <el-button text :icon="ArrowLeft" @click="router.push({ name: 'species' })">物种库</el-button>
      </div>
    </header>

    <el-skeleton v-if="loading" :rows="8" animated />

    <EmptyState v-else-if="error" title="资料卡不可用" :description="error">
      <el-button @click="router.push({ name: 'species' })">返回物种库</el-button>
    </EmptyState>

    <template v-else-if="card">
      <div class="toolbar card">
        <span class="muted">查看范围</span>
        <el-select v-model="scopeSiteId" placeholder="全部地点" clearable class="toolbar__site" @change="loadCard">
          <el-option v-for="site in siteStore.sites" :key="site.id" :label="site.name" :value="site.id" />
        </el-select>
        <span class="spacer"></span>
        <el-button type="primary" :icon="Link" @click="openShareDialog">生成只读链接</el-button>
      </div>

      <SpeciesCardPanel :card="card" />
    </template>

    <el-dialog v-model="shareDialogVisible" title="物种资料卡 · 只读链接" width="min(560px, 92vw)">
      <el-alert
        type="info"
        :closable="false"
        title="链接只能看到该物种的资料卡；可再限定到单个地点，其他物种与地点不会暴露。"
        class="share-dialog__alert"
      />
      <el-form label-position="top">
        <el-form-item label="有效期">
          <el-select v-model="shareForm.expiresInDays" class="share-dialog__field">
            <el-option label="7 天" :value="7" />
            <el-option label="30 天" :value="30" />
            <el-option label="90 天" :value="90" />
            <el-option label="365 天" :value="365" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="shareForm.siteScoped">限定到单个地点</el-checkbox>
          <el-select
            v-if="shareForm.siteScoped"
            v-model="shareForm.siteId"
            placeholder="选择地点"
            class="share-dialog__field"
          >
            <el-option v-for="site in siteStore.sites" :key="site.id" :label="site.name" :value="site.id" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-button type="primary" :loading="creating" :disabled="shareForm.siteScoped && !shareForm.siteId" @click="createShare">
        生成链接
      </el-button>

      <ul v-if="links.length" class="link-list">
        <li v-for="link in links" :key="link.id" class="link-list__item">
          <div class="link-list__body">
            <code class="link-list__url">{{ link.url }}</code>
            <span class="muted link-list__meta">
              {{ link.siteId ? "单地点" : "全部地点" }} · 有效期至 {{ dayjs(link.expiresAt).format("YYYY-MM-DD") }}
              · 浏览 {{ link.viewCount }} 次
            </span>
          </div>
          <el-button size="small" @click="copyLink(link)">复制</el-button>
          <el-button size="small" type="danger" plain @click="revoke(link)">撤销</el-button>
        </li>
      </ul>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header__back {
  margin-bottom: 4px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.toolbar__site {
  width: 200px;
}

.share-dialog__alert {
  margin-bottom: 14px;
}

.share-dialog__field {
  width: 220px;
}

.link-list {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.link-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}

.link-list__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.link-list__url {
  font-size: 12px;
  word-break: break-all;
}

.link-list__meta {
  font-size: 12px;
}
</style>
