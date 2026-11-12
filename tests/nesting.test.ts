import { describe, expect, it } from "vitest";
import { demo, footprint, issues, type Piece } from "@/lib/model";
import { autoArrange } from "@/lib/nesting";

const piece = (id: string, w: number, h: number, over: Partial<Piece> = {}): Piece => ({
  ...demo().pieces[0], id, name: id, w, h, x: 40, y: 40, holeW: 0, holeH: 0, ...over,
});

describe("auto-arrange", () => {
  it("packs overlapping pieces without any placement issue", () => {
    const pr = demo();
    pr.pieces = Array.from({ length: 8 }, (_, i) => piece("p" + i, 700, 450)); // all stacked at the same spot
    expect(issues(pr).length).toBeGreaterThan(0);
    const r = autoArrange(pr);
    expect(r.unplaced).toEqual([]);
    expect(issues(r.project)).toEqual([]);
  });
  it("turns a piece 90° when that is the only way it fits", () => {
    const pr = demo();
    pr.pieces = [piece("long", 600, 2500)]; // 2500 tall > 1960 usable height
    const r = autoArrange(pr);
    const p = r.project.pieces[0];
    expect(r.unplaced).toEqual([]);
    expect(footprint(p)).toEqual({ w: 2500, h: 600 });
    expect(issues(r.project)).toEqual([]);
  });
  it("moves pieces to another slab when the first is full", () => {
    const pr = demo();
    pr.slabs.push({ ...pr.slabs[0], id: "s2", name: "Second" });
    pr.pieces = [piece("a", 3000, 1500), piece("b", 3000, 1500)];
    const r = autoArrange(pr);
    expect(r.project.pieces.map((p) => p.slab).sort()).toEqual(["s1", "s2"]);
    expect(issues(r.project)).toEqual([]);
  });
  it("reports pieces that fit nowhere and leaves them in place", () => {
    const pr = demo();
    pr.pieces = [piece("huge", 5000, 3000, { x: 7, y: 9 })];
    const r = autoArrange(pr);
    expect(r.unplaced).toEqual(["huge"]);
    expect(r.project.pieces[0]).toMatchObject({ x: 7, y: 9 });
  });
  it("'only problems' keeps well-placed pieces where they are", () => {
    const pr = demo(); // three demo pieces, correctly placed
    pr.pieces.push(piece("extra", 800, 400, { x: 100, y: 100 })); // overlaps the island top
    const r = autoArrange(pr, { onlyProblems: true });
    const keep = (id: string) => r.project.pieces.find((p) => p.id === id)!;
    // The island top was involved in the overlap, so it may move; the sink counter was not.
    expect(keep("p3")).toMatchObject({ x: pr.pieces[2].x, y: pr.pieces[2].y });
    expect(issues(r.project)).toEqual([]);
  });
});
