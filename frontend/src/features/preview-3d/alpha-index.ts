// ===== AlphaIndex — 面级透明特征索引（ADR-118 Phase B）=====
// 复刻 upstream/ModernYSM YSMClientMapper.TranslucencyScanner：
// 逐像素 alpha 三态 flags + 8×8 tile 前缀和 → O(1) 查任意 UV 矩形的三态出现情况，
// 供 mesh 按面（三角 UV 包围盒）路由渲染路径。
export const ALPHA_F_VISIBLE = 1;
export const ALPHA_F_HOLE = 2;
export const ALPHA_F_TRANSLUCENT = 4;

const TILE = 8;
const SMALL_RECT_LIMIT = 128;

export function flagsForAlpha(a: number): number {
  if (a === 255) return ALPHA_F_VISIBLE;
  if (a === 0) return ALPHA_F_HOLE;
  return ALPHA_F_TRANSLUCENT;
}

export class AlphaIndex {
  readonly width: number;
  readonly height: number;
  private readonly stride: number;
  private readonly grids: Map<number, Int32Array>;
  private readonly rgba: ArrayLike<number>;

  constructor(rgba: ArrayLike<number>, width: number, height: number) {
    this.rgba = rgba;
    this.width = width;
    this.height = height;
    const cols = Math.ceil(width / TILE);
    const rows = Math.ceil(height / TILE);
    this.stride = cols + 1;
    const mk = () => new Int32Array(this.stride * (rows + 1));
    this.grids = new Map([
      [ALPHA_F_VISIBLE, mk()],
      [ALPHA_F_HOLE, mk()],
      [ALPHA_F_TRANSLUCENT, mk()],
    ]);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const f = flagsForAlpha(rgba[(y * width + x) * 4 + 3] ?? 255);
        const cell = (Math.floor(y / TILE) + 1) * this.stride + (Math.floor(x / TILE) + 1);
        this.grids.get(f)![cell]++;
      }
    }
    for (const g of this.grids.values()) {
      for (let ty = 1; ty < rows + 1; ty++) {
        for (let tx = 1; tx < cols + 1; tx++) {
          g[ty * this.stride + tx] += g[(ty - 1) * this.stride + tx] +
            g[ty * this.stride + tx - 1] - g[(ty - 1) * this.stride + tx - 1];
        }
      }
    }
  }

  query(x0: number, y0: number, x1: number, y1: number): number {
    if (x1 < x0 || y1 < y0) return 0;
    const cx0 = Math.max(0, x0);
    const cy0 = Math.max(0, y0);
    const cx1 = Math.min(this.width - 1, x1);
    const cy1 = Math.min(this.height - 1, y1);
    if (cx1 < cx0 || cy1 < cy0) return 0;
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) <= SMALL_RECT_LIMIT) {
      let exact = 0;
      for (let y = cy0; y <= cy1; y++) {
        for (let x = cx0; x <= cx1; x++) {
          exact |= flagsForAlpha(this.rgba[(y * this.width + x) * 4 + 3] ?? 255);
        }
      }
      return exact;
    }
    const t0x = Math.floor(cx0 / TILE);
    const t1x = Math.floor(cx1 / TILE);
    const t0y = Math.floor(cy0 / TILE);
    const t1y = Math.floor(cy1 / TILE);
    let flags = 0;
    for (const [f, g] of this.grids) {
      const n =
        g[(t1y + 1) * this.stride + (t1x + 1)] - g[t0y * this.stride + (t1x + 1)] -
        g[(t1y + 1) * this.stride + t0x] + g[t0y * this.stride + t0x];
      if (n > 0) flags |= f;
    }
    return flags;
  }
}
