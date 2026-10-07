<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import dayjs from "dayjs";
import { shareApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import EmptyState from "@/components/EmptyState.vue";
import SpeciesCardPanel from "@/components/SpeciesCardView.vue";
import type { SpeciesCardShareView } from "@/types/models";

const route = useRoute();

const data = ref<SpeciesCardShareView | null>(null);
const loading = ref(true);
const error = ref("");
let timer: ReturnType<typeof setTimeout> | null = null;

async function load(silent = false) {
  try {
    const current = await shareApi.viewSpeciesCard(
      String(route.params.token),
      silent && data.value ? data.value.card.revision : undefined,
    );
    // 带 revision 轮询且后端确认口径未变时，不替换内容，避免无谓刷新。
    if (current.share.unchanged !== true) data.value = current;
  } catch (err) {
    if (!silent) error.value = apiErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  // 每 60 秒带 revision 轻量轮询：来源删除/改期后，打开的页面自动同步口径。
  timer = setInterval(() => load(true), 60_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="page page--wide">
    <el-skeleton v-if="loading" :rows="8" animated />

    <EmptyState v-else-if="error" title="分享链接不可用" :description="error" />

    <template v-else-if="data">
      <header class="share-meta card">
        <p class="muted share-meta__line">
          由 {{ data.owner.displayName }} 分享的物种资料卡 · 有效期至
          {{ dayjs(data.share.expiresAt).format("YYYY-MM-DD") }} · 已被浏览 {{ data.share.viewCount }} 次
        </p>
      </header>

      <SpeciesCardPanel :card="data.card" readonly />
    </template>
  </div>
</template>

<style scoped>
.share-meta {
  padding: 10px 16px;
  margin-bottom: 14px;
}

.share-meta__line {
  margin: 0;
  font-size: 13px;
}
</style>
