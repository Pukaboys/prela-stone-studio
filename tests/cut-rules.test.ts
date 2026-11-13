import { describe, expect, it } from "vitest";
import { CUT_DEFAULTS, cutRules, demo, findFreeSpot, issues, pieceGap, setOpenings, validProject, type Opening, type Piece, type Project } from "@/lib/model";

const base = demo().pieces[0];
const piece = (o: Partial<Piece>): Piece => ({ ...base, holeW: 0, holeH: 0, ...o }) as Piece;
function project(pieces: Piece[], extra: Partial<Project> = {}): Project {
  return { ...demo(), pieces, ...extra };
}

describe("cutting rules", () => {
  it("old projects without rules use the standard values", () => {
    const pr = demo();
    expect(cutRules(pr)).toEqual(CUT_DEFAULTS);
    expect(pieceGap(pr)).toBe(4);
  });
  it("space between pieces: checks, snap and auto-arrange follow it, never below the saw", () => {
    const a = piece({ id: "a", name: "A", w: 500, h: 500, x: 40, y: 40 });
    const b = piece({ id: "b", name: "B", w: 500, h: 500, x: 550, y: 40 }); // 10 mm apart
    expect(issues(project([a, b]))).toEqual([]);
    const wide = project([a, b], { cut: { gap: 20 } });
    expect(pieceGap(wide)).toBe(20);
    expect(issues(wide).some((i) => i.text.includes("less than 20 mm apart"))).toBe(true);
    expect(findFreeSpot(project([a], { cut: { gap: 20 } }), "s1", 500, 500)).toEqual({ x: 560, y: 20 }); // 40 + 500 + 20 mm space; top at the 20 mm edge trim
    expect(pieceGap(project([], { kerf: 8, cut: { gap: 2 } }))).toBe(8);
  });
  it("distance from defects", () => {
    const a = piece({ id: "a", name: "A", w: 500, h: 500, x: 40, y: 40 });
    const defects = [{ id: "d", slab: "s1", x: 560, y: 40, w: 50, h: 50 }];
    expect(issues(project([a], { defects }))).toEqual([]);
    const strict = project([a], { defects, cut: { defectClearance: 30 } });
    expect(issues(strict).some((i) => i.text.includes("closer than 30 mm to a marked defect"))).toBe(true);
  });
  it("cut-outs: distance to the edge and to each other", () => {
    const sink: Opening = { id: "s", label: "Sink", w: 500, h: 400, kind: "rect", edgeX: "left", dx: 30, edgeY: "front", dy: 100 };
    const counter = piece({ id: "c", name: "Counter", w: 1800, h: 620, x: 40, y: 40, ...setOpenings([sink]) });
    expect(issues(project([counter])).some((i) => i.text.includes("closer than 50 mm to the piece edge"))).toBe(true); // 30 mm < 50
    expect(issues(project([counter], { cut: { openingEdge: 0 } }))).toEqual([]); // check off
    const tap: Opening = { id: "t", label: "Tap", w: 35, h: 35, kind: "ellipse", edgeX: "left", dx: 300, edgeY: "front", dy: 520 };
    const two = piece({ ...counter, ...setOpenings([{ ...sink, dx: 100 }, tap]) });
    expect(issues(project([two]))).toEqual([]); // 20 mm apart, saw only
    expect(issues(project([two], { cut: { openingGap: 40 } })).some((i) => i.text.includes("Sink is closer than 40 mm to Tap"))).toBe(true);
  });
  it("validation accepts known rules only", () => {
    expect(validProject(JSON.parse(JSON.stringify(project([], { cut: { gap: 6, openingEdge: 60 } }))))).toBe(true);
    expect(validProject(JSON.parse(JSON.stringify({ ...demo(), cut: { gap: -1 } })))).toBe(false);
    expect(validProject(JSON.parse(JSON.stringify({ ...demo(), cut: { evil: 1 } })))).toBe(false);
  });
});
