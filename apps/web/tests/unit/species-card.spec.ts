import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import SpeciesCardPanel from "@/components/SpeciesCardView.vue";
import type { SpeciesCard } from "@/types/models";

const card: SpeciesCard = {
  kind: "SPECIES_CARD",
  species: {
    id: "sp-1",
    category: "PLANT",
    commonName: "银杏",
    scientificName: "Ginkgo biloba",
    family: "银杏科",
    description: "叶扇形，秋季金黄。",
  },
  scope: { siteId: null, siteName: null },
  phenophases: [
    {
      id: "ph-1",
      name: "发芽",
      color: "#3F6F52",
      orderIndex: 0,
      isDefault: true,
      observationCount: 2,
      firstSeen: { date: "2024-03-18", dayOfYear: 78 },
      lastSeen: { date: "2025-03-12" },
      years: [2024, 2025],
    },
    {
      id: "ph-2",
      name: "展叶",
      color: "#5C8F62",
      orderIndex: 1,
      isDefault: false,
      observationCount: 0,
      firstSeen: null,
      lastSeen: null,
      years: [],
    },
  ],
  firstAppearances: [
    {
      year: 2024,
      firstDate: "2024-03-18",
      dayOfYear: 78,
      phenophaseId: "ph-1",
      phenophaseName: "发芽",
      color: "#3F6F52",
      observationId: "obs-2024",
      photoCount: 0,
    },
    {
      year: 2025,
      firstDate: "2025-03-12",
      dayOfYear: 71,
      phenophaseId: "ph-1",
      phenophaseName: "发芽",
      color: "#3F6F52",
      observationId: "obs-2025",
      photoCount: 1,
    },
  ],
  years: [
    { year: 2024, observationCount: 1, photoCount: 0 },
    { year: 2025, observationCount: 1, photoCount: 1 },
  ],
  photos: [
    {
      id: "photo-1",
      observationId: "obs-2025",
      observationDate: "2025-03-12",
      siteId: "site-1",
      siteName: "校园银杏道",
      phenophaseId: "ph-1",
      phenophaseName: "发芽",
      color: "#3F6F52",
      thumbUrl: "/files/thumb/2025/03/a.webp",
      displayUrl: "/files/display/2025/03/a.webp",
      width: 480,
      height: 360,
      bytes: 1024,
      takenAt: null,
      sortOrder: 0,
    },
  ],
  stats: {
    observationCount: 2,
    photoCount: 1,
    siteCount: 1,
    yearCount: 2,
    firstObservationDate: "2024-03-18",
    lastObservationDate: "2025-03-12",
  },
  revision: "abc123def456ghij",
  generatedAt: "2026-10-07T00:00:00.000Z",
};

async function mountPanel(readonly = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/observations/:id", name: "observation-detail", component: { template: "" } }],
  });
  const push = vi.spyOn(router, "push");
  const wrapper = mount(SpeciesCardPanel, {
    props: { card, readonly },
    global: {
      plugins: [router],
      stubs: {
        PhotoLightbox: true,
        "el-tag": { template: "<span><slot /></span>" },
      },
    },
  });
  await router.isReady();
  return { wrapper, push };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("SpeciesCardView", () => {
  it("展示照片、物候阶段与历年首现日期", async () => {
    const { wrapper } = await mountPanel();
    const text = wrapper.text();
    expect(text).toContain("银杏");
    expect(text).toContain("历年首现日期");
    expect(text).toContain("2024-03-18");
    expect(text).toContain("2025-03-12");
    expect(text).toContain("展叶");
    expect(text).toContain("暂无记录");
    expect(wrapper.findAll(".photo-grid__item")).toHaveLength(1);
  });

  it("只读模式下显示只读标记且首现行不可点击", async () => {
    const { wrapper } = await mountPanel(true);
    expect(wrapper.text()).toContain("只读分享");
    expect(wrapper.findAll("tr.is-clickable")).toHaveLength(0);
  });

  it("本人模式下点击首现行跳转到观测详情", async () => {
    const { wrapper, push } = await mountPanel(false);
    await wrapper.findAll("tbody tr")[0].trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "observation-detail", params: { id: "obs-2024" } });
  });
});
