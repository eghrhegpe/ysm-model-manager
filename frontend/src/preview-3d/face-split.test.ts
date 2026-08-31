import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { splitMeshByFaceAlpha } from "./face-split.ts";
import type { SpecMeshGroup3D } from "./model3d.ts";

/** 8×8：左半 x<4 全透（洞），右半 128 半透（全局判 blend） */
function mixedTexture(): THREE.DataTexture {
  const data = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i++) {
    const x = i % 8;
    data[i * 4] = 100;
    data[i * 4 + 1] = 100;
    data[i * 4 + 2] = 100;
    data[i * 4 + 3] = x < 4 ? 0 : 128;
  }
  return new THREE.DataTexture(data, 8, 8);
}

function quadMesh(uvs: number[]): SpecMeshGroup3D {
  return {
    id: "quad",
    boneId: "root",
    texIdx: 0,
    localPosition: [1, 0, 0],
    localRotation: [0, 0, 0, 1],
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs,
    indices: [0, 1, 2, 0, 2, 3],
  };
}

describe("splitMeshByFaceAlpha", () => {
  it("splits triangles into fragments by their UV region alpha", () => {
    const tex = mixedTexture();
    // flipY=false（YSM 主链路）：v 即图像行域；tri1 UV 在左半（洞），tri2 在右半（半透）
    const md: SpecMeshGroup3D = {
      id: "two-tris",
      boneId: "root",
      texIdx: 0,
      localPosition: [1, 0, 0],
      localRotation: [0, 0, 0, 1],
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [
        0, 0.5, 0.25, 0.5, 0.25, 1,
        0.5, 0, 0.75, 0, 0.75, 0.25,
      ],
      indices: [0, 1, 2, 3, 4, 5],
    };
    const frags = splitMeshByFaceAlpha(md, tex)!;
    expect(frags).toHaveLength(2);
    expect(new Set(frags.map((f) => f.mode))).toEqual(
      new Set(["cutout", "blend"]),
    );
    for (const f of frags) {
      expect(f.md.positions).toHaveLength(9);
      expect(f.md.indices).toHaveLength(3);
      expect(f.md.boneId).toBe("root");
      expect(f.md.texIdx).toBe(0);
      expect(f.md.localPosition).toEqual([1, 0, 0]);
      expect(f.md.localRotation).toEqual([0, 0, 0, 1]);
      for (const idx of f.md.indices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(3);
      }
    }
  });

  it("returns one unchanged fragment for uniformly opaque textures", () => {
    const data = new Uint8Array(8 * 8 * 4).fill(255);
    const md = quadMesh([0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5]);
    const frags = splitMeshByFaceAlpha(md, new THREE.DataTexture(data, 8, 8))!;
    expect(frags).toHaveLength(1);
    expect(frags[0]!.mode).toBe("opaque");
    expect(frags[0]!.md.uvs).toEqual(md.uvs);
    expect(frags[0]!.md.indices).toEqual(md.indices);
  });

  it("falls back to null for flipped or unreadable textures", () => {
    const md = quadMesh([0, 0, 1, 0, 1, 1, 0, 1]);
    const flipped = mixedTexture();
    flipped.flipY = true;
    expect(splitMeshByFaceAlpha(md, flipped)).toBeNull();

    const empty = new THREE.DataTexture(undefined as unknown as ConstructorParameters<typeof THREE.DataTexture>[0], 0, 0);
    expect(splitMeshByFaceAlpha(md, empty)).toBeNull();
  });
});
