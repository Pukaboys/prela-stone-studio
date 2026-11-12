import { describe, expect, it } from "vitest";
import { demo, setOpenings, type Piece, type Project } from "@/lib/model";
import { DEFAULT_PRICING, cutList, projectDxf, quote } from "@/lib/production";

/** One 1000 × 500 counter, front mitred below, back polished, sink + tap hole. */
function job(): Project {
  const pr = demo();
  const p: Piece = {
    ...pr.pieces[0],
    w: 1000,
    h: 500,
    x: 20,
    y: 20,
    edges: { front: "below" },
    finishes: { back: "polished", left: "bullnose" },
    ...setOpenings([
      { id: "s", label: "Sink", w: 400, h: 300, kind: "rect", edgeX: "left", dx: 300, edgeY: "front", dy: 100 },
      { id: "t", label: "Tap", w: 35, h: 35, kind: "ellipse", edgeX: "left", dx: 482, edgeY: "back", dy: 40 },
    ]),
  };
  pr.pieces = [p];
  return pr;
}

describe("quote", () => {
  const pricing = {
    ...DEFAULT_PRICING,
    stonePerM2: 200,
    waste: 10,
    cutPerM: 10,
    mitrePerM: 30,
    finishPerM: { polished: 15, bullnose: 40 },
    openingRect: 80,
    openingRound: 20,
    vat: 20,
  };
  const q = quote(job(), pricing);
  const line = (label: string) => q.lines.find((l) => l.label.startsWith(label))!;

  it("measures edges, mitres and openings", () => {
    expect(q.totals.mitreM).toBeCloseTo(1.0, 6); // front side
    expect(line("Edge: Polished").qty).toBeCloseTo(1.0, 6); // back side
    expect(line("Edge: Bullnose").qty).toBeCloseTo(0.5, 6); // left side
    expect(q.totals.rectHoles).toBe(1);
    expect(q.totals.roundHoles).toBe(1);
    // Saw: piece perimeter 3 m + sink 1.4 m + tap π·35 mm
    expect(q.totals.cutM).toBeCloseTo(3 + 1.4 + (Math.PI * 35) / 1000, 6);
  });
  it("prices the stone by finished area plus offcuts", () => {
    const finished = (1000 * 500 - 400 * 300 - Math.PI * 17.5 ** 2) / 1e6;
    expect(q.totals.finishedM2).toBeCloseTo(finished, 3);
    expect(line("Stone").total).toBeCloseTo(finished * 1.1 * 200, 1);
  });
  it("adds VAT", () => {
    const sum = q.lines.reduce((a, l) => a + l.total, 0);
    expect(q.subtotal).toBeCloseTo(sum, 6);
    expect(q.total).toBeCloseTo(sum * 1.2, 6);
  });
});

describe("cut list", () => {
  it("lists pieces per slab with edges and openings", () => {
    const [s] = cutList(job());
    expect(s.pieces).toHaveLength(1);
    const c = s.pieces[0];
    expect(c.size).toBe("1000 × 500");
    expect(c.edges.find((e) => e.side === "Front")).toMatchObject({ cut: "45° below", finish: "Joint", lengthMm: 1000 });
    expect(c.edges.find((e) => e.side === "Back")).toMatchObject({ cut: "Straight", finish: "Polished" });
    expect(c.openings.map((o) => o.label + " " + o.size)).toEqual(["Sink 400 × 300", "Tap Ø35"]);
  });
});

describe("DXF", () => {
  const dxf = projectDxf(job());
  it("is an R12 DXF with the expected layers", () => {
    expect(dxf).toContain("AC1009");
    expect(dxf.trim().endsWith("EOF")).toBe(true);
    for (const layer of ["SLAB", "MARGIN", "CUT", "OPENING", "MITRE_BELOW", "TEXT"]) expect(dxf).toContain("\r\n8\r\n" + layer + "\r\n");
  });
  it("flips Y (DXF Y points up): piece at y=20 on a 2000 mm slab spans 1980 down to 1480", () => {
    const lines = dxf.split("\r\n");
    const ys: number[] = [];
    let inCut = false;
    for (let i = 0; i < lines.length - 1; i += 2) {
      const [code, value] = [lines[i], lines[i + 1]];
      if (code === "0") inCut = false;
      if (code === "8" && value === "CUT") inCut = true;
      if (inCut && code === "20") ys.push(Number(value));
    }
    expect(Math.max(...ys)).toBeCloseTo(1980, 3);
    expect(Math.min(...ys)).toBeCloseTo(1480, 3);
  });
});
