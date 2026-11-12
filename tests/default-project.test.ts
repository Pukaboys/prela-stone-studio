import { describe, expect, it } from "vitest";
import { defaultProject, issues, validProject } from "@/lib/model";

describe("default project (Kitchen study · 01)", () => {
  it("is valid and has its pieces, defect and prices", () => {
    const p = defaultProject();
    expect(validProject(p)).toBe(true);
    expect(p.id).toBe("");
    expect(p.name).toBe("Kitchen study · 01");
    expect(p.pieces.map((q) => q.name)).toEqual(["Island top", "Backsplash", "Sink counter", "Sink counter edge"]);
    expect(p.defects).toHaveLength(1);
    expect(p.pricing?.stonePerM2).toBe(250);
  });
  it("returns a fresh copy each time", () => {
    const a = defaultProject();
    a.pieces[0].w = 1;
    expect(defaultProject().pieces[0].w).toBe(1800);
  });
  it("has no placement issues", () => {
    expect(issues(defaultProject())).toEqual([]);
  });
});
