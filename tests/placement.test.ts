import { describe, expect, it } from "vitest";
import {
  demo,
  findFreeSpot,
  footprint,
  holeDistances,
  issues,
  nudgeHole,
  opening,
  outlineOnSlab,
  placement,
  removeSlab,
  rotateOnSlab,
  setHoleDistance,
  slabAngleOf,
  validProject,
  type Piece,
} from "@/lib/model";
import { pieceOutline } from "@/lib/shapes";

const sink = demo().pieces[2]; // 1800 × 620 with a 500 × 380 opening

describe("slab rotation", () => {
  it("legacy 90° pieces keep their exact placement", () => {
    const p: Piece = { ...sink, rot: true, x: 100, y: 50 };
    const old = pieceOutline(p).map((q) => ({ x: p.x + p.h - q.y, y: p.y + q.x }));
    outlineOnSlab(p).forEach((q, i) => {
      expect(q.x).toBeCloseTo(old[i].x, 9);
      expect(q.y).toBeCloseTo(old[i].y, 9);
    });
    expect(footprint(p)).toEqual({ w: 620, h: 1800 });
    expect(slabAngleOf(p)).toBe(90);
  });
  it("45° footprint", () => {
    const d = footprint({ ...sink, slabAngle: 45 });
    expect(d.w).toBeCloseTo((1800 + 620) / Math.SQRT2, 2);
  });
  it("rotating keeps the footprint centre", () => {
    const p0: Piece = { ...sink, x: 700, y: 600, rot: false };
    const p1 = { ...p0, ...rotateOnSlab(p0, 30) } as Piece;
    const c = (p: Piece) => ({ x: p.x + footprint(p).w / 2, y: p.y + footprint(p).h / 2 });
    expect(Math.hypot(c(p0).x - c(p1).x, c(p0).y - c(p1).y)).toBeLessThan(0.2);
  });
  it("normalises angles", () => {
    expect(slabAngleOf({ rot: false, slabAngle: 370 })).toBe(10);
    expect(slabAngleOf({ rot: false, slabAngle: -190 })).toBe(170);
  });
  it("slab → piece inverse (2D assembly texture) round-trips", () => {
    const m = placement({ ...sink, slabAngle: 33, x: 400, y: 300 });
    const s = m.slab({ x: 123, y: 456 });
    const back = { x: m.cos * (s.x - m.origin.x) + m.sin * (s.y - m.origin.y), y: -m.sin * (s.x - m.origin.x) + m.cos * (s.y - m.origin.y) };
    expect(back.x).toBeCloseTo(123, 9);
    expect(back.y).toBeCloseTo(456, 9);
  });
  it("overhanging rotated piece saves and is flagged", () => {
    const pr = demo();
    pr.pieces[0] = { ...pr.pieces[0], ...rotateOnSlab({ ...pr.pieces[0], x: 20, y: 20 }, 10) } as Piece;
    expect(pr.pieces[0].x).toBeLessThan(0);
    expect(validProject(JSON.parse(JSON.stringify(pr)))).toBe(true);
    expect(issues(pr).some((i) => i.text.includes("outside usable slab edge"))).toBe(true);
  });
});

describe("free spots and slabs", () => {
  it("places a new piece exactly 4 mm from its neighbour", () => {
    expect(findFreeSpot(demo(), "s1", 800, 600)).toEqual({ x: 1844, y: 20 });
  });
  it("deleting a slab moves its pieces without overlaps", () => {
    const pr = demo();
    pr.slabs.push({ id: "s2", name: "Second", w: 3200, h: 2000, thickness: 20, image: "/demo-slab.png" });
    pr.pieces[1] = { ...pr.pieces[1], slab: "s2", x: 20, y: 20 };
    pr.defects.push({ id: "d1", slab: "s2", x: 100, y: 100, w: 50, h: 50 });
    const after = removeSlab(pr, "s2");
    expect(after.slabs.map((s) => s.id)).toEqual(["s1"]);
    expect(after.defects).toEqual([]);
    expect(after.pieces.map((p) => p.slab)).toEqual(["s1", "s1", "s1"]);
    expect(issues(after)).toEqual([]);
  });
  it("the last slab cannot be deleted", () => {
    const only = demo();
    expect(removeSlab(only, "s1")).toBe(only);
  });
});

describe("opening distances from edges", () => {
  it("legacy centred, edge switch keeps position, width change keeps chosen edge", () => {
    let p = sink;
    expect(holeDistances(p)).toMatchObject({ edgeX: "left", dx: 650, edgeY: "front", dy: 120 });
    p = { ...p, ...setHoleDistance(p, { dx: 350 }) };
    p = { ...p, ...setHoleDistance(p, { dy: 100 }) };
    expect(opening(p)).toMatchObject({ x: 350, y: 140 });
    p = { ...p, ...setHoleDistance(p, { edgeX: "right" }) };
    expect(holeDistances(p).dx).toBe(950);
    p = { ...p, w: 2000 };
    expect(opening(p).x).toBe(550);
    p = { ...p, ...nudgeHole(p, 5, 5) };
    expect(opening(p)).toMatchObject({ x: 555, y: 145 });
  });
});
