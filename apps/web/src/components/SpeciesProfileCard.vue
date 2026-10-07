<script setup lang="ts">
import { computed, ref } from "vue";
import dayjs from "dayjs";
import { ElMessage } from "element-plus";
import { Share } from "@element-plus/icons-vue";
import { profileApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import EmptyState from "@/components/EmptyState.vue";
import { useSiteStore } from "@/stores/site";
import { useUiStore } from "@/stores/ui";
import { CATEGORY_LABELS, type SpeciesProfile } from "@/types/models";

const props = withDefaults(
  defineProps<{
    profile: SpeciesProfile;
    /** 只读分享视图下隐藏分享按钮等可操作元素。 */
    readOnly?: boolean;
  }>(),
  { readOnly: false },
);

const ui = useUiStore();
const siteStore = useSiteStore();

const activePhaseId = ref<string>("ALL");

const shareDialogVisible = ref(false);
const shareSiteId = ref<string>("");
const shareExpiresInDays = ref(30);
const shareUrl = ref("");
const creatingShare = ref(false);

const categoryLabel = computed(() => CATEGORY_LABELS[props.profile.species.category] ?? "");

const shareableSites = computed(() =>
  // 仅可对该物种已有已发布观测的地点生成只读分享
  siteStore.sites.filter((site) => props.profile.sites.some((item) => item.id === site.id)),
);

const onsetRows = computed(() => {
  if (activePhaseId.value === "ALL") return props.profile.overall.items;
  const phase = props.profile.phases.find(
    (item) => (item.phenophase.id ?? "NONE") === activePhaseId.value,
  );
  return phase?.items ?? [];
});

function onsetOffsetClass(item: { offsetVsBaseline?: number | null; offsetVsPrevYear?: number | null }) {
  const value = item.offsetVsBaseline ?? item.offsetVsPrevYear;
  if (value === null || value === undefined) return "";
  if (value < 0) return "is-early";
  if (value > 0) return "is-late";
  return "is-same";
}

function openGallery(index: number) {
  ui.openLightbox(
    props.profile.photos.map((photo) => ({
      id: photo.id,
      thumbUrl: photo.thumbUrl,
      displayUrl: photo.displayUrl,
      originalUrl: photo.originalUrl,
      width: photo.width,
      height: photo.height,
      bytes: 0,
      takenAt: photo.takenAt,
      sortOrder: 0,
    })),
    index,
  );
}

function openShare() {
  shareUrl.value = "";
  shareSiteId.value = props.profile.sites[0]?.id ?? "";
  shareDialogVisible.value = true;
}

async function createShare() {
  if (!shareSiteId.value) {
    ElMessage.warning("请选择要限定的地点");
    return;
  }
  creatingShare.value = true;
  try {
    const link = await profileApi.createSpeciesShare(props.profile.species.id, {
      siteId: shareSiteId.value,
      expiresInDays: shareExpiresInDays.value,
    });
    shareUrl.value = link.url;
    try {
      await navigator.clipboard.writeText(link.url);
      ElMessage.success("只读链接已生成并复制");
    } catch {
      ElMessage.success("只读链接已生成，请手动复制");
    }
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    creatingShare.value = false;
  }
}

function formatDate(value: string | null): string {
  return value ? dayjs(value).format("MM-DD") : "—";
}
</script>

<template>
  <div class="profile">
    <!-- 头部 -->
    <header class="card profile__header">
      <div>
        <div class="row profile__title-row">
          <h1 class="profile__name">{{ profile.species.commonName }}</h1>
          <el-tag size="small" effect="plain">{{ categoryLabel }}</el-tag>
          <el-tag v-if="readOnly" size="small" type="info">只读分享</el-tag>
        </div>
        <p v-if="profile.species.scientificName" class="profile__latin muted">
          {{ profile.species.scientificName }}<span v-if="profile.species.family"> · {{ profile.species.family }}</span>
        </p>
        <p v-if="profile.species.description" class="profile__description">{{ profile.species.description }}</p>
      </div>
      <el-button v-if="!readOnly" size="small" @click="openShare">
        <el-icon><Share /></el-icon>
        生成只读资料卡
      </el-button>
    </header>

    <!-- 汇总指标 -->
    <section class="card profile__stats">
      <div class="profile__stat"><span class="profile__stat-value">{{ profile.summary.observationCount }}</span><span>观测</span></div>
      <div class="profile__stat"><span class="profile__stat-value">{{ profile.summary.photoCount }}</span><span>照片</span></div>
      <div class="profile__stat"><span class="profile__stat-value">{{ profile.summary.siteCount }}</span><span>地点</span></div>
      <div class="profile__stat"><span class="profile__stat-value">{{ profile.summary.yearCount }}</span><span>年份</span></div>
      <div class="profile__stat profile__stat--wide">
        <span class="muted profile__stat-range">
          {{ profile.summary.firstObservationDate ?? "—" }} ～ {{ profile.summary.lastObservationDate ?? "—" }}
        </span>
        <span>记录区间</span>
      </div>
    </section>

    <!-- 历年首现日 -->
    <section class="card profile__section">
      <div class="profile__section-head">
        <h2 class="profile__section-title">历年首现日</h2>
        <el-radio-group v-model="activePhaseId" size="small">
          <el-radio-button value="ALL">物种整体</el-radio-button>
          <el-radio-button v-for="phase in profile.phases" :key="phase.phenophase.id ?? 'none'" :value="phase.phenophase.id ?? 'NONE'">
            {{ phase.phenophase.name }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <EmptyState
        v-if="!onsetRows.length"
        title="还没有首现日数据"
        description="发布带日期的观测后，这里会按年份汇总最早的一条。"
      />

      <div v-else class="onset-table">
        <div class="onset-table__head">
          <span>年份</span><span>首现日</span><span>序日</span><span>对比基准</span>
        </div>
        <div v-for="item in onsetRows" :key="item.year" class="onset-table__row">
          <span class="onset-table__year">{{ item.year }}</span>
          <span>{{ item.onsetDate ? dayjs(item.onsetDate).format("YYYY-MM-DD") : "—" }}</span>
          <span class="muted">{{ item.dayOfYear ?? "—" }}</span>
          <span :class="['onset-table__offset', onsetOffsetClass(item)]">{{ item.offsetText }}</span>
        </div>
      </div>
      <p class="muted profile__hint">
        首现日取每个日历年观测日期最早的已发布记录；序日映射到统一平年参照系。历史不足 2 年时不计算基准偏移。
      </p>
    </section>

    <!-- 物候阶段 -->
    <section class="card profile__section">
      <h2 class="profile__section-title">物候阶段</h2>
      <div v-if="profile.phenophases.length" class="phase-chips">
        <div v-for="phase in profile.phenophases" :key="phase.id" class="phase-chip">
          <span class="phase-chip__dot" :style="{ background: phase.color }"></span>
          <span>{{ phase.name }}</span>
        </div>
      </div>
      <p v-else class="muted">尚未配置物候阶段。</p>
    </section>

    <!-- 照片墙 -->
    <section class="card profile__section">
      <h2 class="profile__section-title">照片（{{ profile.photos.length }}）</h2>
      <EmptyState
        v-if="!profile.photos.length"
        title="还没有照片"
        description="在观测记录里上传照片后会汇集到这里。"
      />
      <div v-else class="gallery">
        <button
          v-for="(photo, index) in profile.photos"
          :key="photo.id"
          type="button"
          class="gallery__item"
          @click="openGallery(index)"
        >
          <img :src="photo.thumbUrl" :alt="`${profile.species.commonName} ${photo.observationDate}`" loading="lazy" />
          <span class="gallery__date">{{ formatDate(photo.observationDate) }}</span>
        </button>
      </div>
    </section>

    <!-- 分享范围与生成对话框 -->
    <el-dialog v-model="shareDialogVisible" title="只读资料卡分享" width="min(520px, 92vw)">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="链接持有者只能查看该物种在所选地点的已发布内容（照片、阶段、历年首现日），看不到其他地点，也无法修改任何数据。"
        class="profile__alert"
      />
      <el-form label-position="top">
        <el-form-item label="限定地点" required>
          <el-select v-model="shareSiteId" placeholder="选择地点" class="profile__select">
            <el-option v-for="site in shareableSites" :key="site.id" :label="site.name" :value="site.id" />
          </el-select>
          <p v-if="!shareableSites.length" class="muted">该物种还没有任何地点的已发布观测，暂无可分享范围。</p>
        </el-form-item>
        <el-form-item label="有效期">
          <el-select v-model="shareExpiresInDays">
            <el-option :value="7" label="7 天" />
            <el-option :value="30" label="30 天" />
            <el-option :value="90" label="90 天" />
            <el-option :value="365" label="365 天" />
          </el-select>
        </el-form-item>
      </el-form>
      <div v-if="shareUrl" class="profile__share-url">
        <code>{{ shareUrl }}</code>
      </div>
      <template #footer>
        <el-button @click="shareDialogVisible = false">关闭</el-button>
        <el-button type="primary" :loading="creatingShare" :disabled="!shareableSites.length" @click="createShare">
          生成只读链接
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.profile {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.profile__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
}

.profile__title-row {
  gap: 8px;
}

.profile__name {
  margin: 0;
  font-size: 20px;
}

.profile__latin {
  margin: 4px 0 0;
  font-size: 12px;
  font-style: italic;
}

.profile__description {
  margin: 8px 0 0;
  font-size: 14px;
}

.profile__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  padding: 14px 16px;
}

.profile__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.profile__stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
}

.profile__stat--wide {
  margin-left: auto;
}

.profile__stat-range {
  font-size: 13px;
}

.profile__section {
  padding: 16px;
}

.profile__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.profile__section-title {
  margin: 0 0 12px;
  font-size: 16px;
}

.profile__section-head .profile__section-title {
  margin-bottom: 0;
}

.onset-table {
  display: flex;
  flex-direction: column;
}

.onset-table__head,
.onset-table__row {
  display: grid;
  grid-template-columns: 80px 140px 80px 1fr;
  gap: 8px;
  padding: 8px 4px;
  font-size: 14px;
  align-items: center;
}

.onset-table__head {
  font-size: 12px;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}

.onset-table__row {
  border-bottom: 1px solid var(--color-border);
}

.onset-table__year {
  font-weight: 600;
}

.onset-table__offset.is-early {
  color: var(--color-primary);
}

.onset-table__offset.is-late {
  color: #b4552f;
}

.onset-table__offset.is-same {
  color: var(--color-text-muted);
}

.profile__hint {
  margin: 10px 0 0;
  font-size: 12px;
}

.phase-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  font-size: 13px;
}

.phase-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.phase-chip__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.gallery__item {
  position: relative;
  padding: 0;
  border: none;
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 1 / 1;
  cursor: pointer;
  background: var(--color-fill, #eef1ee);
}

.gallery__item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.2s ease;
}

.gallery__item:hover img {
  transform: scale(1.05);
}

.gallery__date {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 6px 4px;
  font-size: 11px;
  color: #fff;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
}

.profile__alert {
  margin-bottom: 12px;
}

.profile__select {
  width: 100%;
}

.profile__share-url {
  margin-top: 8px;
  padding: 8px;
  background: var(--color-primary-soft);
  border-radius: 6px;
}

.profile__share-url code {
  font-size: 12px;
  word-break: break-all;
}

@media (max-width: 640px) {
  .onset-table__head,
  .onset-table__row {
    grid-template-columns: 64px 110px 56px 1fr;
  }

  .profile__stat--wide {
    margin-left: 0;
    flex-basis: 100%;
  }
}
</style>
