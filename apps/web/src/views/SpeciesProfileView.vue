<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft } from "@element-plus/icons-vue";
import { profileApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import EmptyState from "@/components/EmptyState.vue";
import SpeciesProfileCard from "@/components/SpeciesProfileCard.vue";
import { useSiteStore } from "@/stores/site";
import { useSpeciesStore } from "@/stores/species";
import type { SpeciesProfile } from "@/types/models";

const route = useRoute();
const router = useRouter();
const siteStore = useSiteStore();
const speciesStore = useSpeciesStore();

const profile = ref<SpeciesProfile | null>(null);
const loading = ref(true);
const error = ref("");

const speciesId = String(route.params.id ?? "");
const speciesName = () => speciesStore.byId(speciesId)?.commonName ?? "物种资料卡";

async function load() {
  loading.value = true;
  error.value = "";
  try {
    await Promise.all([speciesStore.fetch(), siteStore.fetch()]);
    profile.value = await profileApi.species(speciesId);
  } catch (err) {
    error.value = apiErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => route.params.id,
  () => {
    if (route.name === "species-profile") load();
  },
);

onMounted(load);
</script>

<template>
  <div class="page page--wide">
    <div class="profile-back">
      <el-button text :icon="ArrowLeft" @click="router.push({ name: 'species' })">返回物种库</el-button>
    </div>

    <el-skeleton v-if="loading" :rows="8" animated />

    <EmptyState v-else-if="error" title="无法打开资料卡" :description="error" />

    <SpeciesProfileCard v-else-if="profile" :profile="profile" />

    <template v-else>
      <EmptyState title="没有资料" :description="`${speciesName()} 还没有已发布的观测记录。`" />
    </template>
  </div>
</template>

<style scoped>
.profile-back {
  margin-bottom: 8px;
}
</style>
