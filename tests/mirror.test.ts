import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { demo, validProject } from "@/lib/model";
import { buildPieceGeometry } from "@/lib/piece-mesh";

describe("book-matched (mirrored) slabs", () => {
  const pr = demo();
  const slab = { ...pr.slabs[0], crop: { x: 0, y: 0, w: 1, h: 1 } };
  const piece = { ...pr.pieces[0], x: 40, y: 40 }; // 1800 wide on a 3200 slab
  const uRange = (mirror: boolean) => {
    const uv = buildPieceGeometry(THREE, piece, { ...slab, mirror }).getAttribute("uv");
    let min = 1, max = 0;
    for (let i = 0; i < uv.count; i++) {
      min = Math.min(min, uv.getX(i));
      max = Math.max(max, uv.getX(i));
    }
    return [min, max];
  };
  it("normal slab: piece samples the photo from x = 40 to 1840", () => {
    const [a, b] = uRange(false);
    expect(a).toBeCloseTo(40 / 3200, 6);
    expect(b).toBeCloseTo(1840 / 3200, 6);
  });
  it("mirrored slab: the same piece samples the mirrored strip", () => {
    const [a, b] = uRange(true);
    expect(a).toBeCloseTo(1 - 1840 / 3200, 6);
    expect(b).toBeCloseTo(1 - 40 / 3200, 6);
  });
  it("mirror flag validates", () => {
    const v = demo();
    v.slabs[0] = { ...v.slabs[0], mirror: true };
    expect(validProject(JSON.parse(JSON.stringify(v)))).toBe(true);
  });
});
