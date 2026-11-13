import { describe, expect, it } from "vitest";
import { demo, issues, pieceArea, validProject, type Piece } from "@/lib/model";
import { bounds, pieceOutline, shapeSize, type PieceShape } from "@/lib/shapes";

const base = demo().pieces[0];
const mk = (over: Partial<Piece>): Piece => ({ ...base, holeW: 0, holeH: 0, ...over });
const rel = (a: number, b: number) => Math.abs(a - b) / b;

describe("shape areas", () => {
  it("circle ≈ πr² (curves within 0.2 mm)", () => {
    expect(rel(pieceArea(mk({ w: 600, h: 600, shape: { kind: "ellipse" } })), Math.PI * 300 ** 2)).toBeLessThan(0.002);
  });
  it("rounded rectangle", () => {
    const r = { type: "radius", r: 100 } as const;
    expect(rel(pieceArea(mk({ w: 1000, h: 600, shape: { kind: "rect", corners: [r, r, r, r] } })), 600000 - (4 - Math.PI) * 1e4)).toBeLessThan(0.002);
  });
  it("chamfer", () => {
    const sq = { type: "square" } as const;
    const shape: PieceShape = { kind: "rect", corners: [sq, { type: "chamfer", x: 300, y: 300 }, sq, sq] };
    expect(pieceArea(mk({ w: 1800, h: 300, shape }))).toBeCloseTo(1800 * 300 - 45000, 3);
  });
  it("arch", () => {
    expect(rel(pieceArea(mk({ w: 800, h: 500, shape: { kind: "arch", rise: 400 } })), 80000 + (Math.PI * 400 * 400) / 2)).toBeLessThan(0.003);
  });
  it("oversized corner radius stays inside the box", () => {
    const big = { type: "radius", r: 5000 } as const, sq = { type: "square" } as const;
    const b = bounds(pieceOutline({ w: 600, h: 400, shape: { kind: "rect", corners: [big, big, sq, sq] } }));
    expect(b.w).toBeLessThanOrEqual(600.001);
    expect(b.h).toBeLessThanOrEqual(400.001);
  });
  it("curved band size and area", () => {
    const bend: PieceShape = { kind: "bend", band: 100, radius: 300, angle: 90, legA: 200, legB: 500 };
    const size = shapeSize(bend)!;
    expect(size).toEqual({ w: 600, h: 900 });
    const ring = (Math.PI / 4) * (400 ** 2 - 300 ** 2) + 100 * 200 + 100 * 500;
    expect(rel(pieceArea(mk({ ...size, shape: bend })), ring)).toBeLessThan(0.003);
  });
});

describe("placement checks use real outlines", () => {
  const pr = demo();
  const circle = mk({ id: "a", name: "Circle", w: 600, h: 600, x: 40, y: 40, shape: { kind: "ellipse" } });
  it("a circle's empty corner can hold another piece", () => {
    pr.pieces = [circle, mk({ id: "b", name: "Square", w: 400, h: 400, x: 600, y: 600 })];
    expect(issues(pr)).toEqual([]);
  });
  it("real overlap is flagged", () => {
    pr.pieces = [circle, mk({ id: "b", name: "Square", w: 400, h: 400, x: 500, y: 300 })];
    expect(issues(pr).some((i) => i.text.includes("overlap"))).toBe(true);
  });
  it("exactly 4 mm passes, 2 mm is flagged", () => {
    pr.pieces = [circle, mk({ id: "b", name: "Square", w: 400, h: 400, x: 644, y: 300 })];
    expect(issues(pr)).toEqual([]);
    pr.pieces[1] = { ...pr.pieces[1], x: 642 };
    expect(issues(pr).some((i) => i.text.includes("less than 4 mm apart"))).toBe(true);
  });
  it("opening cut by an arch's curve is flagged", () => {
    pr.pieces = [
      mk({ id: "t", name: "Arch", w: 800, h: 500, x: 40, y: 40, shape: { kind: "arch", rise: 400 }, holeW: 200, holeH: 100, holeDX: 0, holeEdgeX: "left", holeDY: 400, holeEdgeY: "front" }),
    ];
    expect(issues(pr).some((i) => i.text.includes("extends outside the piece"))).toBe(true);
  });
});

describe("validation", () => {
  it("accepts shapes, rejects degenerate polygons", () => {
    const v = demo();
    v.pieces[1] = { ...v.pieces[1], shape: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] } };
    expect(validProject(JSON.parse(JSON.stringify(v)))).toBe(true);
    v.pieces[1] = { ...v.pieces[1], shape: { kind: "polygon", points: [{ x: 0, y: 0 }] } as PieceShape };
    expect(validProject(JSON.parse(JSON.stringify(v)))).toBe(false);
  });
});
