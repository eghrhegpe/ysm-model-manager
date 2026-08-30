import { describe, expect, it } from "vitest";
import { bakeMeshFragments } from "./mesh-baker.ts";
import type { MeshFragment } from "./face-split.ts";
import type { SpecMeshGroup3D } from "./model3d.ts";

function frag(
  id: string,
  mode: MeshFragment["mode"],
  overrides: Partial<SpecMeshGroup3D> = {},
): MeshFragment {
  return {
    mode,
    md: {
      id,
      boneId: "root",
      texIdx: 0,
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 0, 1, 0, 0, 1],
      indices: [0, 1, 2],
      ...overrides,
    },
  };
}

describe("bakeMeshFragments", () => {
  it("merges same-mode fragments on one bone into one batch with transforms applied", () => {
    const baked = bakeMeshFragments([
      frag("a", "opaque"),
      frag("b", "opaque", {
        localPosition: [2, 0, 0],
        positions: [0, 0, 0, -1, 0, 0, 0, 1, 0],
      }),
    ]);
    expect(baked).toHaveLength(1);
    const positions = baked[0]!.md.positions;
    expect(positions).toHaveLength(18);
    expect(positions[3]).toBeCloseTo(1);
    expect(positions[9]).toBeCloseTo(2);
    expect(baked[0]!.md.indices).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps different alpha modes in separate batches", () => {
    const baked = bakeMeshFragments([frag("a", "blend"), frag("b", "cutout")]);
    expect(baked).toHaveLength(2);
    expect(new Set(baked.map((b) => b.md.id)).size).toBe(2);
  });

  it("zeroes local transforms after baking them into vertices", () => {
    const baked = bakeMeshFragments([
      frag("a", "cutout", { localPosition: [5, 6, 7], localRotation: [0, 0, 0, 1] }),
    ]);
    expect(baked[0]!.md.localPosition).toEqual([0, 0, 0]);
    expect(baked[0]!.md.localRotation).toEqual([0, 0, 0, 1]);
    expect(baked[0]!.md.positions[0]).toBeCloseTo(5);
    expect(baked[0]!.md.positions[1]).toBeCloseTo(6);
    expect(baked[0]!.md.positions[2]).toBeCloseTo(7);
  });
});
