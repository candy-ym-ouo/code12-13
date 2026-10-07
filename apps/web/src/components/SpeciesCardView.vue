<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import PhotoLightbox from "@/components/PhotoLightbox.vue";
import { useUiStore } from "@/stores/ui";
import { CATEGORY_LABELS, type SpeciesCard } from "@/types/models";

const props = defineProps<{ card: SpeciesCard; readonly?: boolean }>();

const router = useRouter();
const ui = useUiStore();

const activePhases = computed(() => props.card.phenophases.filter((phase) => phase.observationCount > 0));
const silentPhases = computed(() => props.card.phenophases.filter((phase) => phase.observationCount === 0));

function openLightbox(index: number) {
  ui.openLightbox(props.card.photos, index);
}

function openObservation(id: string | null) {
  if (props.readonly || !id) return;
  router.push({ name: "observation-detail", params: { id } });
}
</script>

<template>
  <div class="species-card">
    <header class="species-card__header card">
      <div>
        <div class="species-card__title-row">
          <h1 class="species-card__name">{{ card.species.commonName }}</h1>
          <el-tag size="small" effect="plain">{{ CATEGORY_LABELS[card.species.category] }}</el-tag>
          <el-tag v-if="readonly" size="small" type="info">只读分享</el-tag>
        </div>
        <p v-if="card.species.scientificName" class="species-card__latin muted">{{ card.species.scientificName }}</p>
        <p v-if="card.species.family" class="muted species-card__family">{{ card.species.family }}</p>
        <p v-if="card.species.description" class="species-card__description">{{ card.species.description }}</p>
      </div>
      <dl class="species-card__stats">
        <div><dt>观测</dt><dd>{{ card.stats.observationCount }}</dd></div>
        <div><dt>照片</dt><dd>{{ card.stats.photoCount }}</dd></div>
        <div><dt>年份</dt><dd>{{ card.stats.yearCount }}</dd></div>
        <div><dt>地点</dt><dd>{{ card.stats.siteCount }}</dd></div>
      </dl>
    </header>

    <p v-if="card.scope.siteName" class="species-card__scope muted">
      范围限定：{{ card.scope.siteName }}
    </p>

    <section class="card species-card__section">
      <h2 class="species-card__section-title">历年首现日期</h2>
      <EmptyState
        v-if="!card.firstAppearances.length"
        title="还没有已发布的记录"
        description="记录该物种后，这里会按年份汇总每年最早的一次出现。"
      />
      <table v-else class="first-table">
        <thead>
          <tr><th>年份</th><th>首现日期</th><th>物候阶段</th><th class="num">当年记录</th><th class="num">照片</th></tr>
        </thead>
        <tbody>
          <tr
            v-for="item in card.firstAppearances"
            :key="item.year"
            :class="{ 'is-clickable': !readonly && item.observationId }"
            @click="openObservation(item.observationId)"
          >
            <td>{{ item.year }}</td>
            <td>{{ item.firstDate }}</td>
            <td>
              <span v-if="item.phenophaseName" class="phase-chip">
                <span class="phase-chip__dot" :style="{ background: item.color ?? '#999' }"></span>
                {{ item.phenophaseName }}
              </span>
              <span v-else class="muted">未标注</span>
            </td>
            <td class="num">{{ card.years.find((y) => y.year === item.year)?.observationCount ?? 0 }}</td>
            <td class="num">{{ item.photoCount }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="card species-card__section">
      <h2 class="species-card__section-title">物候阶段</h2>
      <EmptyState v-if="!card.phenophases.length" title="尚未配置物候阶段" description="在物种管理中为该物种添加阶段。" />
      <ul v-else class="phase-list">
        <li v-for="phase in activePhases" :key="phase.id" class="phase-list__item">
          <span class="phase-chip">
            <span class="phase-chip__dot" :style="{ background: phase.color }"></span>
            {{ phase.name }}
          </span>
          <span class="muted">共 {{ phase.observationCount }} 条</span>
          <span v-if="phase.firstSeen" class="muted">最早 {{ phase.firstSeen.date }}</span>
          <span v-if="phase.lastSeen && phase.lastSeen.date !== phase.firstSeen?.date" class="muted">
            最晚 {{ phase.lastSeen.date }}
          </span>
          <span class="phase-list__years">
            <el-tag v-for="year in phase.years" :key="year" size="small" effect="plain">{{ year }}</el-tag>
          </span>
        </li>
        <li v-for="phase in silentPhases" :key="phase.id" class="phase-list__item phase-list__item--empty">
          <span class="phase-chip">
            <span class="phase-chip__dot" :style="{ background: phase.color }"></span>
            {{ phase.name }}
          </span>
          <span class="muted">暂无记录</span>
        </li>
      </ul>
    </section>

    <section class="card species-card__section">
      <h2 class="species-card__section-title">照片（{{ card.photos.length }}）</h2>
      <EmptyState v-if="!card.photos.length" title="还没有照片" description="上传到观测记录的照片会自动汇集到这里。" />
      <div v-else class="photo-grid">
        <button
          v-for="(photo, index) in card.photos"
          :key="photo.id"
          type="button"
          class="photo-grid__item"
          :aria-label="`${photo.observationDate} 的照片`"
          @click="openLightbox(index)"
        >
          <img :src="photo.thumbUrl" :alt="`${card.species.commonName} ${photo.observationDate}`" loading="lazy" />
          <span class="photo-grid__meta">{{ photo.observationDate }} · {{ photo.siteName }}</span>
        </button>
      </div>
    </section>

    <PhotoLightbox />
  </div>
</template>

<style scoped>
.species-card__header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
  flex-wrap: wrap;
}

.species-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.species-card__name {
  margin: 0;
  font-size: 22px;
}

.species-card__latin {
  margin: 4px 0 0;
  font-style: italic;
  font-size: 13px;
}

.species-card__family {
  margin: 2px 0 0;
  font-size: 13px;
}

.species-card__description {
  margin: 8px 0 0;
  font-size: 14px;
  max-width: 52ch;
}

.species-card__stats {
  display: flex;
  gap: 16px;
  margin: 0;
  align-self: flex-start;
}

.species-card__stats div {
  text-align: center;
  min-width: 48px;
}

.species-card__stats dt {
  font-size: 12px;
  color: var(--color-text-muted);
}

.species-card__stats dd {
  margin: 2px 0 0;
  font-size: 20px;
  font-weight: 600;
}

.species-card__scope {
  margin: 8px 2px;
  font-size: 13px;
}

.species-card__section {
  margin-top: 14px;
  padding: 16px;
}

.species-card__section-title {
  margin: 0 0 12px;
  font-size: 16px;
}

.first-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.first-table th,
.first-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
}

.first-table th {
  color: var(--color-text-muted);
  font-weight: 500;
  font-size: 13px;
}

.first-table .num {
  text-align: right;
}

.first-table tr.is-clickable {
  cursor: pointer;
}

.first-table tr.is-clickable:hover {
  background: var(--color-fill-light, rgba(0, 0, 0, 0.03));
}

.phase-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.phase-chip__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.phase-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.phase-list__item {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 14px;
}

.phase-list__item--empty {
  opacity: 0.7;
}

.phase-list__years {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}

.photo-grid__item {
  position: relative;
  padding: 0;
  border: none;
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 4 / 3;
  background: var(--color-fill-light, rgba(0, 0, 0, 0.05));
  cursor: pointer;
}

.photo-grid__item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.photo-grid__meta {
  position: absolute;
  inset: auto 0 0 0;
  padding: 14px 8px 6px;
  font-size: 11px;
  color: #fff;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
  text-align: left;
}
</style>
