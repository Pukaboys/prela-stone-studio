import { describe, expect, it } from "vitest";
import { demo, issues, openingBox, openingsOf, pieceArea, setOpenings, validProject, type Opening, type Piece } from "@/lib/model";

const counter = demo().pieces[2]; // legacy single 500 × 380 opening, 1800 × 620
const sink: Opening = { id: "s", label: "Sink", w: 500, h: 400, kind: "rounded", r: 20, edgeX: "left", dx: 400, edgeY: "front", dy: 100 };
const tap: Opening = { id: "t", label: "Tap hole", w: 35, h: 35, kind: "ellipse", edgeX: "left", dx: 632, edgeY: "front", dy: 520 };

describe("multiple openings", () => {
  it("legacy single opening reads as a one-item list", () => {
    const list = openingsOf(counter);
    expect(list).toHaveLength(1);
    expect(openingBox(counter, list[0])).toEqual({ x: 650, y: 120, w: 500, h: 380 });
  });
  it("box from edge distances", () => {
    expect(openingBox(counter, sink)).toEqual({ x: 400, y: 120, w: 500, h: 400 });
    expect(openingBox(counter, { ...sink, edgeX: "right", edgeY: "back", dx: 100, dy: 50 })).toEqual({ x: 1200, y: 50, w: 500, h: 400 });
  });
  it("area subtracts every opening", () => {
    const p = { ...counter, ...setOpenings([sink, tap]) } as Piece;
    const sinkArea = 500 * 400 - (4 - Math.PI) * 20 * 20;
    const tapArea = Math.PI * 17.5 * 17.5;
    expect(Math.abs(pieceArea(p) - (1800 * 620 - sinkArea - tapArea))).toBeLessThan(10);
  });
  it("valid layout passes; openings too close or outside are flagged", () => {
    const pr = demo();
    pr.pieces = [{ ...counter, ...setOpenings([sink, tap]) } as Piece];
    expect(issues(pr)).toEqual([]);
    pr.pieces = [{ ...counter, ...setOpenings([sink, { ...tap, dy: 502 }]) } as Piece];
    expect(issues(pr).some((i) => i.text.includes("Sink is closer than 4 mm to Tap hole"))).toBe(true);
    pr.pieces = [{ ...counter, ...setOpenings([{ ...sink, dx: 1500 }]) } as Piece];
    expect(issues(pr).some((i) => i.text.includes("Sink extends outside the piece"))).toBe(true);
  });
  it("setOpenings clears legacy fields and validates", () => {
    const pr = demo();
    pr.pieces[2] = { ...counter, ...setOpenings([sink, tap]) } as Piece;
    expect(pr.pieces[2].holeW).toBe(0);
    expect(openingsOf(pr.pieces[2])).toHaveLength(2);
    expect(validProject(JSON.parse(JSON.stringify(pr)))).toBe(true);
    pr.pieces[2] = { ...pr.pieces[2], openings: [{ ...sink, edgeX: "middle" } as unknown as Opening] };
    expect(validProject(JSON.parse(JSON.stringify(pr)))).toBe(false);
  });
});
