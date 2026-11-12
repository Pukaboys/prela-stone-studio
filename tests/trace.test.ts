import { describe, expect, it } from "vitest";
import { traceShapes, type RawImage } from "@/lib/trace";

/** White image with dark shapes drawn by a predicate. */
function draw(w: number, h: number, dark: (x: number, y: number) => boolean): RawImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = dark(x, y) ? 20 : 240, i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { data, width: w, height: h };
}

describe("shape scanner", () => {
  const img = draw(400, 200, (x, y) =>
    // circle r=60 at (90,100) and a 140 × 80 rectangle at (220,60)
    Math.hypot(x - 90, y - 100) <= 60 || (x >= 220 && x < 360 && y >= 60 && y < 140),
  );
  const { shapes, darkShapes } = traceShapes(img);

  it("finds both shapes, in reading order, dark on light", () => {
    expect(darkShapes).toBe(true);
    expect(shapes).toHaveLength(2);
    expect(shapes[0].box.x).toBeLessThan(shapes[1].box.x);
  });
  it("circle: size and area", () => {
    const c = shapes[0];
    expect(c.box.w).toBeGreaterThanOrEqual(119);
    expect(c.box.w).toBeLessThanOrEqual(122);
    expect(Math.abs(c.areaPx - Math.PI * 60 * 60) / (Math.PI * 3600)).toBeLessThan(0.03);
  });
  it("rectangle: exact box, few points", () => {
    const r = shapes[1];
    expect(r.box).toEqual({ x: 220, y: 60, w: 140, h: 80 });
    expect(r.points.length).toBeLessThanOrEqual(12);
  });
  it("normalised points span 0..1", () => {
    for (const s of shapes) {
      const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
      expect(Math.min(...xs)).toBeCloseTo(0, 6);
      expect(Math.max(...xs)).toBeCloseTo(1, 6);
      expect(Math.min(...ys)).toBeCloseTo(0, 6);
      expect(Math.max(...ys)).toBeCloseTo(1, 6);
    }
  });
  it("light shapes on dark background", () => {
    const inv = draw(200, 200, (x, y) => !(Math.hypot(x - 100, y - 100) <= 50));
    const r = traceShapes(inv);
    expect(r.darkShapes).toBe(false);
    expect(r.shapes).toHaveLength(1);
  });
});
