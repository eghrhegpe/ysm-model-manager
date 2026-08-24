import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "../../test-utils/index.ts";

const mocks = vi.hoisted(() => ({
  getApp: vi.fn(),
  listModels: vi.fn(),
  listAuthors: vi.fn(),
  getModel: vi.fn(),
  downloadModel: vi.fn(),
  login: vi.fn(),
}));

vi.mock("../../backend/app.ts", () => ({ getApp: mocks.getApp }));
vi.mock("../../services/ysmhub.ts", () => ({
  listYSMHubModels: mocks.listModels,
  listYSMHubAuthors: mocks.listAuthors,
  getYSMHubModel: mocks.getModel,
  downloadYSMHubModel: mocks.downloadModel,
  loginYSMHub: mocks.login,
}));

import { initYSMHubPage } from "./init-ysmhub.ts";
import { ysmHubHTML } from "./tpl-ysmhub.ts";

const model = {
  id: 42,
  slug: "alice-model",
  title: "Alice Model",
  owner_name: "Alice",
};

function makeHost() {
  const root = document.createElement("div");
  root.innerHTML = ysmHubHTML();
  (root as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => root.querySelector(`#${id}`);
  const host = { _root: root as unknown as ShadowRoot, _unsubs: [] as Array<() => void> };
  initYSMHubPage(host);
  return { root, host };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listModels.mockResolvedValue({ items: [model], total: 1, page: 1, page_size: 24, total_pages: 1 });
  mocks.listAuthors.mockResolvedValue({ items: [{ name: "Alice", model_count: 3 }] });
  mocks.getModel.mockResolvedValue({
    model,
    versions: [
      { id: 7, version_name: "ZIP" },
      { id: 8, version_name: "YSM" },
    ],
  });
  mocks.downloadModel.mockImplementation((_modelId, versionId, saveDir) => Promise.resolve({
    path: `${saveDir}/model-${versionId === "7" ? "zip" : "ysm"}`,
  }));
  mocks.getApp.mockResolvedValue({
    GetRepoRoot: vi.fn(() => "C:/Games/.minecraft/config/yes_steve_model/custom"),
  });
});

describe("YSM Hub author categories and downloads", () => {
  it("opens an author category view and filters models by the selected author", async () => {
    const { root, host } = makeHost();
    await waitFor(() => root.querySelector("[data-hub-slug]"));
    await waitFor(() => (root.querySelector("#ysmhub-author") as HTMLSelectElement).options.length === 2);

    (root.querySelector("#ysmhub-author-view") as HTMLButtonElement).click();
    const authorCard = root.querySelector('[data-hub-author-name="Alice"]') as HTMLButtonElement;
    expect(authorCard).not.toBeNull();
    authorCard.click();

    await waitFor(() => mocks.listModels.mock.calls.length >= 2);
    expect(mocks.listModels).toHaveBeenLastCalledWith(expect.objectContaining({ author: "Alice", sort: "author" }));
    host._unsubs.forEach((off) => off());
  });

  it("uses the selected YSM repository root for both ZIP and YSM downloads", async () => {
    const { root, host } = makeHost();
    await waitFor(() => root.querySelector("[data-hub-slug]"));
    (root.querySelector("[data-hub-slug]") as HTMLElement).click();
    await waitFor(() => root.querySelectorAll("[data-hub-download]").length === 2);

    const buttons = root.querySelectorAll<HTMLButtonElement>("[data-hub-download]");
    buttons[0]!.click();
    await waitFor(() => mocks.downloadModel.mock.calls.length === 1);
    buttons[1]!.click();
    await waitFor(() => mocks.downloadModel.mock.calls.length === 2);

    const selectedRoot = "C:/Games/.minecraft/config/yes_steve_model/custom";
    expect(mocks.downloadModel.mock.calls.map((call) => call[2])).toEqual([selectedRoot, selectedRoot]);
    expect(mocks.getApp.mock.results[0]?.value).toBeDefined();
    host._unsubs.forEach((off) => off());
  });
});
