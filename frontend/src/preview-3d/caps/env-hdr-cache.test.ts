// ===== env-hdr-cache.ts 守卫（ADR-091-d1 拆分叶 + ADR-311-d1 判别样本）=====
// 病根锁：custom HDR 四态（tex/name/loading/warnedMissing）+ RGBELoader 解码管线下沉 EnvHdrCache，
// 此前仅经 environment-capability.test.ts 白盒探针间接覆盖。本测试把**叶层语义**双侧钉死：
//   · loadFromFile 成功 / 失败 / 替换旧缓存三分支（判真 + 判非真）
//   · thumbnail 双态（无缓存 null / 有缓存降采样 dataURL）
//   · dispose 清空 + warnedMissing 读写
// 正当依赖隔离（非自证）：mock RGBELoader（外部依赖）、customHdrThumbnail（像素运算，env-pixels 独立单测）、
// ringLog（重依赖）；断言目标始终是 EnvHdrCache 自身导出。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";
import { EnvHdrCache } from "./env-hdr-cache.ts";

const h = vi.hoisted(() => ({
  thumbnailMock: vi.fn(),
  logMock: vi.fn(),
  pendingLoad: {
    onLoad: null as null | ((t: unknown) => void),
    onError: null as null | ((e: unknown) => void),
  },
}));

vi.mock("./env-pixels.ts", () => ({ customHdrThumbnail: h.thumbnailMock }));
vi.mock("./scene-capability.ts", () => ({ ringLog: h.logMock }));
vi.mock("three/addons/loaders/RGBELoader.js", () => ({
  RGBELoader: class {
    setDataType() {
      return this;
    }
    load(
      _url: string,
      onLoad: (t: unknown) => void,
      _onProgress: unknown,
      onError: (e: unknown) => void,
    ) {
      h.pendingLoad.onLoad = onLoad;
      h.pendingLoad.onError = onError;
    }
  },
}));

function makeCache(): EnvHdrCache {
  return new EnvHdrCache();
}

function makeFile(name = "a.hdr"): File {
  return { name } as unknown as File;
}

/** 构造一个 RGBELoader 会回调的假 DataTexture（loadFromFile 只写它的 mapping/colorSpace） */
function makeFakeTex(): THREE.DataTexture {
  return new THREE.DataTexture(new Uint8Array(4), 1, 1);
}

beforeEach(() => {
  h.pendingLoad.onLoad = null;
  h.pendingLoad.onError = null;
  h.thumbnailMock.mockReset();
  h.logMock.mockReset();
  // 真实现 env-pixels.customHdrThumbnail 对 null 输入返回 null——mock 须保真该判真侧，
  // 否则「thumbnail 无缓存返回 null」反例退化为假阳（判别样本专门抓这种 mock 失真）
  h.thumbnailMock.mockImplementation((tex: unknown) =>
    tex ? "data:image/png;base64,thumb" : null,
  );
  // jsdom 未必实现 blob URL——loadFromFile 用它，stub 掉
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  // 清理可能残留的 createObjectURL stub，避免污染同文件其他用例
  vi.restoreAllMocks();
});

describe("EnvHdrCache 初始态与 getter", () => {
  it("初始四态：无缓存 / 无名字 / 不加载中 / 未告警", () => {
    const c = makeCache();
    expect(c.has(), "无缓存").toBe(false);
    expect(c.tex).toBeNull();
    expect(c.name).toBe("");
    expect(c.loading).toBe(false);
    expect(c.warnedMissing, "未告警").toBe(false);
  });

  it("warnedMissing 可读写（buildCustomHdrTex 去重告警依赖）", () => {
    const c = makeCache();
    expect(c.warnedMissing).toBe(false);
    c.warnedMissing = true;
    expect(c.warnedMissing).toBe(true);
  });

  it("thumbnail 无缓存返回 null（双态之反例）", () => {
    const c = makeCache();
    expect(c.thumbnail(128, 64)).toBeNull();
    expect(h.thumbnailMock, "无缓存不触像素运算").not.toHaveBeenCalled();
  });

  it("dispose 幂等：空缓存 dispose 不抛错", () => {
    const c = makeCache();
    expect(() => c.dispose()).not.toThrow();
  });
});

describe("EnvHdrCache.loadFromFile 三分支（ADR-311-d1 判别样本）", () => {
  it("成功：tex 写入缓存 + 记名 + 复位告警 + 设置 mapping/colorSpace", async () => {
    const c = makeCache();
    c.warnedMissing = true; // 成功应复位
    const tex = makeFakeTex();
    const p = c.loadFromFile(makeFile("my.hdr"));
    expect(c.loading, "解码期间 loading=true").toBe(true);
    h.pendingLoad.onLoad?.(tex);
    const ok = await p;

    expect(ok).toBe(true);
    expect(c.has()).toBe(true);
    expect(c.tex, "写入的是 loader 回调的同一纹理").toBe(tex);
    expect(c.name).toBe("my.hdr");
    expect(c.warnedMissing, "成功复位告警").toBe(false);
    expect(c.loading, "解码结束 loading=false").toBe(false);
    // 教训 433477：mapping 必设 + Linear 空间标记（HDR(RGBE) 是 Linear 输入）
    expect(tex.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(tex.colorSpace).toBe(THREE.LinearSRGBColorSpace);
    // three r186 Texture.needsUpdate **只有 setter**（getter 恒 undefined，同 Material 口径
    // sky-capability.test.ts:770 / water-capability.test.ts:741）——副作用认 `version` 递增
    expect(tex.version, "needsUpdate=true 触发重传（version 递增）").toBeGreaterThan(0);
  });

  it("失败：返回 false + 清空缓存（不留中间态）+ ringLog warn", async () => {
    const c = makeCache();
    const p = c.loadFromFile(makeFile("bad.hdr"));
    h.pendingLoad.onError?.(new Error("decode boom"));
    const ok = await p;

    expect(ok).toBe(false);
    expect(c.has(), "失败清缓存").toBe(false);
    expect(c.name, "失败清名").toBe("");
    expect(c.loading, "失败后 loading 复位").toBe(false);
    expect(h.logMock, "失败走 warn 日志").toHaveBeenCalledWith("env", expect.stringContaining("解码失败"), "warn");
  });

  it("替换旧缓存：先写新再 dispose 旧（避免引用悬空）", async () => {
    const c = makeCache();
    const oldTex = makeFakeTex();
    const p1 = c.loadFromFile(makeFile("a.hdr"));
    h.pendingLoad.onLoad?.(oldTex);
    await p1;
    const oldDispose = vi.spyOn(oldTex, "dispose");
    expect(c.tex).toBe(oldTex);

    const newTex = makeFakeTex();
    const p2 = c.loadFromFile(makeFile("b.hdr"));
    h.pendingLoad.onLoad?.(newTex);
    await p2;

    expect(c.tex, "新纹理生效").toBe(newTex);
    expect(c.name).toBe("b.hdr");
    expect(oldDispose, "旧缓存恰 dispose 一次").toHaveBeenCalledTimes(1);
  });

  it("旧缓存替换失败：新失败不留下旧缓存已释放的空档", async () => {
    const c = makeCache();
    const oldTex = makeFakeTex();
    const p1 = c.loadFromFile(makeFile("a.hdr"));
    h.pendingLoad.onLoad?.(oldTex);
    await p1;
    const oldDispose = vi.spyOn(oldTex, "dispose");

    const p2 = c.loadFromFile(makeFile("b.hdr"));
    h.pendingLoad.onError?.(new Error("boom2"));
    await p2;

    // 失败路径整清（含旧缓存）——保持「失败不留中间缓存」纪律
    expect(c.has()).toBe(false);
    expect(oldDispose).toHaveBeenCalledTimes(1);
  });
});

describe("EnvHdrCache.thumbnail（双态）", () => {
  it("有缓存时把缓存纹理降采样为 dataURL", async () => {
    const c = makeCache();
    const tex = makeFakeTex();
    const p = c.loadFromFile(makeFile("a.hdr"));
    h.pendingLoad.onLoad?.(tex);
    await p;

    const url = c.thumbnail(128, 64);
    expect(url).toBe("data:image/png;base64,thumb");
    expect(h.thumbnailMock).toHaveBeenCalledWith(tex, 128, 64);
  });

  it("默认尺寸 128×64（与 cap 侧 getCustomHdrThumbnail 同口径）", async () => {
    const c = makeCache();
    const tex = makeFakeTex();
    const p = c.loadFromFile(makeFile("a.hdr"));
    h.pendingLoad.onLoad?.(tex);
    await p;

    c.thumbnail();
    expect(h.thumbnailMock).toHaveBeenCalledWith(tex, 128, 64);
  });

  it("[S7-3] 同尺寸 memo 命中：不重复像素运算；换尺寸/换图/释放均失效", async () => {
    const c = makeCache();
    const tex = makeFakeTex();
    const p = c.loadFromFile(makeFile("a.hdr"));
    h.pendingLoad.onLoad?.(tex);
    await p;

    c.thumbnail(128, 64);
    c.thumbnail(128, 64);
    expect(h.thumbnailMock, "同尺寸二次调用应命中 memo，不重复像素运算").toHaveBeenCalledTimes(1);

    c.thumbnail(64, 32);
    expect(h.thumbnailMock, "换尺寸重算一次").toHaveBeenCalledTimes(2);

    // 换图失效
    const p2 = c.loadFromFile(makeFile("b.hdr"));
    h.pendingLoad.onLoad?.(makeFakeTex());
    await p2;
    c.thumbnail(128, 64);
    expect(h.thumbnailMock, "贴图变更后缩略图缓存失效并重算").toHaveBeenCalledTimes(3);

    // 释放失效
    c.dispose();
    expect(c.thumbnail(128, 64)).toBeNull();
    expect(h.thumbnailMock, "dispose 后无缓存不触像素运算").toHaveBeenCalledTimes(3);
  });
});

describe("EnvHdrCache.dispose（清空）", () => {
  it("dispose 释放缓存纹理 + 清名 + 不复位 warnedMissing 之外的无关态", async () => {
    const c = makeCache();
    const tex = makeFakeTex();
    const p = c.loadFromFile(makeFile("a.hdr"));
    h.pendingLoad.onLoad?.(tex);
    await p;
    c.warnedMissing = true;
    const disposeSpy = vi.spyOn(tex, "dispose");

    c.dispose();

    expect(disposeSpy, "缓存纹理恰释放一次").toHaveBeenCalledTimes(1);
    expect(c.has()).toBe(false);
    expect(c.tex).toBeNull();
    expect(c.name).toBe("");
    // warnedMissing 是交互告警状态，dispose 不动它（由 loadFromFile 成功时复位）
    expect(c.warnedMissing).toBe(true);
  });
});