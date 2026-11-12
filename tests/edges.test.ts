import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { edgeCutsOf, edgeSummary, mitredFaces, mitreStrips } from "@/lib/edges";
import { demo, validProject, type Piece } from "@/lib/model";
import { buildPieceGeometry } from "@/lib/piece-mesh";
import { bounds, pieceOutline } from "@/lib/shapes";

const box = (pts: { x: number; y: number }[]) => {
  const b = bounds(pts);
  return [b.x, b.y, b.x + b.w, b.y + b.h].map((n) => Math.round(n * 100) / 100);
};
const rect = pieceOutline({ w: 1800, h: 620 });
const straight = { back: "straight", right: "straight", front: "straight", left: "straight" } as const;

describe("mitred faces", () => {
  it("45° below: top full, bottom shorter at that edge", () => {
    const f = mitredFaces(rect, { ...straight, front: "below" }, 20);
    expect(box(f.top)).toEqual([0, 0, 1800, 620]);
    expect(box(f.bottom)).toEqual([0, 0, 1800, 600]);
  });
  it("45° above: top shorter, bottom full", () => {
    const f = mitredFaces(rect, { ...straight, right: "above" }, 20);
    expect(box(f.top)).toEqual([0, 0, 1780, 620]);
    expect(box(f.bottom)).toEqual([0, 0, 1800, 620]);
  });
  it("curves with mixed sides have no spikes", () => {
    const circle = pieceOutline({ w: 600, h: 600, shape: { kind: "ellipse" } });
    const f = mitredFaces(circle, { ...straight, right: "below", left: "above" }, 20);
    for (const face of [f.top, f.bottom]) {
      const [x0, y0, x1, y1] = box(face);
      expect(x0).toBeGreaterThanOrEqual(-0.01);
      expect(y0).toBeGreaterThanOrEqual(-0.01);
      expect(x1).toBeLessThanOrEqual(600.01);
      expect(y1).toBeLessThanOrEqual(600.01);
    }
  });
  it("strip along a mitred edge", () => {
    const s = mitreStrips(rect, { ...straight, front: "below" }, 20);
    expect(s).toHaveLength(1);
    expect(box(s[0].pts)).toEqual([0, 600, 1800, 620]);
  });
  it("legacy cutAngle and summaries", () => {
    expect(edgeCutsOf({ cutAngle: 45 }).front).toBe("below");
    expect(edgeSummary({ edges: { front: "below", left: "above" } })).toBe("Front 45° below · Left 45° above");
  });
  it("validation", () => {
    const v = demo();
    v.pieces[0] = { ...v.pieces[0], edges: { front: "below", right: "above" } };
    expect(validProject(JSON.parse(JSON.stringify(v)))).toBe(true);
    v.pieces[0] = { ...v.pieces[0], edges: { front: "sideways" } as never };
    expect(validProject(JSON.parse(JSON.stringify(v)))).toBe(false);
  });
});

describe("3D solids (volume proves geometry and outward faces)", () => {
  const slab = demo().slabs[0]; // 20 mm thick
  const base: Piece = { ...demo().pieces[0], holeW: 0, holeH: 0, w: 1800, h: 620 };
  const volume = (p: Piece) => {
    const g = buildPieceGeometry(THREE, p, slab);
    const pos = g.getAttribute("position"), idx = g.getIndex();
    let v = 0;
    const tri = (a: number, b: number, c: number) => {
      const A = new THREE.Vector3().fromBufferAttribute(pos, a);
      const B = new THREE.Vector3().fromBufferAttribute(pos, b);
      const C = new THREE.Vector3().fromBufferAttribute(pos, c);
      v += A.dot(B.clone().cross(C)) / 6;
    };
    if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    else for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
    return v;
  };
  it("straight", () => expect(volume(base)).toBeCloseTo(1800 * 620 * 20, 0));
  it("front 45° below removes a 20 × 20 prism", () => expect(volume({ ...base, edges: { front: "below" } })).toBeCloseTo(1800 * 620 * 20 - 1800 * 200, 0));
  it("mitre with sink opening", () => {
    expect(volume({ ...demo().pieces[2], edges: { front: "below" } })).toBeCloseTo(1800 * 620 * 20 - 1800 * 200 - 500 * 380 * 20, 0);
  });
  it("circle mitred all round ≈ frustum", () => {
    const v = volume({ ...base, w: 600, h: 600, shape: { kind: "ellipse" }, edges: { back: "below", right: "below", front: "below", left: "below" } });
    const frustum = ((Math.PI * 20) / 3) * (300 ** 2 + 300 * 280 + 280 ** 2);
    expect(Math.abs(v - frustum) / frustum).toBeLessThan(0.005);
  });
});
