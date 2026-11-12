import { describe, expect, it } from "vitest";
import { detectQuad, order, squareToQuad, type Quad } from "@/lib/perspective";
import type { RawImage } from "@/lib/trace";

describe("squareToQuad", () => {
  const q: Quad = { tl: { x: 10, y: 20 }, tr: { x: 300, y: 5 }, br: { x: 320, y: 260 }, bl: { x: 0, y: 240 } };
  const map = squareToQuad(q);
  it("maps the unit square's corners onto the quad", () => {
    for (const [u, v, p] of [[0, 0, q.tl], [1, 0, q.tr], [1, 1, q.br], [0, 1, q.bl]] as const) {
      const r = map(u, v);
      expect(r.x).toBeCloseTo(p.x, 6);
      expect(r.y).toBeCloseTo(p.y, 6);
    }
  });
  it("keeps straight lines straight (projective)", () => {
    // Points on the line u = 0.5 must be collinear after mapping.
    const a = map(0.5, 0), b = map(0.5, 0.5), c = map(0.5, 1);
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
  });
});

describe("detectQuad", () => {
  /** A light, textured quadrilateral (the slab) on a darker, noisy background. */
  function photo(q: Quad, W = 640, H = 480): RawImage {
    const data = new Uint8ClampedArray(W * H * 4);
    const poly = [q.tl, q.tr, q.br, q.bl];
    const inside = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = 3; i < 4; j = i++) {
        const a = poly[i], b = poly[j];
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const vein = Math.sin((x + 2 * y) / 9) > 0.97 ? 60 : 0; // thin veins inside the slab
        const v = inside(x, y) ? 200 - vein + rnd() * 20 : 70 + rnd() * 40;
        const i = (y * W + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    return { data, width: W, height: H };
  }
  it("finds a slab photographed at an angle", () => {
    const truth: Quad = { tl: { x: 90, y: 70 }, tr: { x: 560, y: 110 }, br: { x: 590, y: 420 }, bl: { x: 60, y: 380 } };
    const r = detectQuad(photo(truth))!;
    expect(r).not.toBeNull();
    for (const k of ["tl", "tr", "br", "bl"] as const) {
      expect(Math.abs(r.quad[k].x * 640 - truth[k].x)).toBeLessThan(8);
      expect(Math.abs(r.quad[k].y * 480 - truth[k].y)).toBeLessThan(8);
    }
    expect(r.confidence).toBeGreaterThan(0.5);
  });
  it("returns null for a plain image", () => {
    const flat = { data: new Uint8ClampedArray(200 * 200 * 4).fill(128), width: 200, height: 200 };
    expect(detectQuad(flat)).toBeNull();
  });
  it("orders corners top-left, top-right, bottom-right, bottom-left", () => {
    const o = order([{ x: 9, y: 9 }, { x: 0, y: 0 }, { x: 0, y: 9 }, { x: 9, y: 0 }]);
    expect(o).toEqual([{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }]);
  });
});
