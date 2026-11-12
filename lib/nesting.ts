/**
 * Automatic layout: place pieces on the slabs to use as little stone as
 * possible. Largest pieces first; each goes to the first free spot
 * (bottom-left packing, keeping the edge trim and the saw gap) on the first
 * slab where it fits, trying its current angle and the angle turned 90°.
 */
import { findFreeSpot, footprint, issues, pieceArea, type Piece, type Project } from "@/lib/model";

export type ArrangeResult = { project: Project; placed: number; unplaced: string[] };

export function autoArrange(pr: Project, opts: { onlyProblems?: boolean; allowTurn?: boolean } = {}): ArrangeResult {
  const allowTurn = opts.allowTurn ?? true;
  // Only placement problems can be fixed by moving pieces (not opening problems).
  const flagged = new Set(
    issues(pr)
      .filter((i) => i.kind === "placement")
      .flatMap((i) => [i.id, i.related].filter(Boolean) as string[]),
  );
  const move = pr.pieces.filter((p) => !opts.onlyProblems || flagged.has(p.id));
  const moving = new Set(move.map((p) => p.id));
  // Start from the pieces that stay put; add the others one by one.
  let current: Project = { ...pr, pieces: pr.pieces.filter((p) => !moving.has(p.id)) };
  const order = [...move].sort((a, b) => pieceArea(b) - pieceArea(a));
  const unplaced: string[] = [];
  const placed = new Map<string, Piece>();

  for (const p of order) {
    const base = p.slabAngle ?? (p.rot ? 90 : 0);
    const angles = allowTurn ? [base, base + 90] : [base];
    let best: Piece | null = null;
    // Prefer the piece's own slab, then the others in order.
    const slabs = [pr.slabs.find((s) => s.id === p.slab)!, ...pr.slabs.filter((s) => s.id !== p.slab)].filter(Boolean);
    for (const slab of slabs) {
      for (const a of angles) {
        const turned: Piece = { ...p, slab: slab.id, slabAngle: ((a % 360) + 360) % 360, rot: false };
        const f = footprint(turned);
        const spot = findFreeSpot(current, slab.id, f.w, f.h);
        if (!spot) continue;
        const candidate = { ...turned, ...spot };
        // Lowest, then leftmost position wins (keeps the rest of the slab open).
        if (!best || best.slab !== slab.id || candidate.y < best.y || (candidate.y === best.y && candidate.x < best.x)) best = candidate;
      }
      if (best) break;
    }
    if (best) {
      placed.set(p.id, best);
      current = { ...current, pieces: [...current.pieces, best] };
    } else unplaced.push(p.name);
  }
  // Keep the original piece order; pieces that did not fit stay where they were.
  const project = { ...pr, pieces: pr.pieces.map((p) => placed.get(p.id) ?? p) };
  return { project, placed: placed.size, unplaced };
}
