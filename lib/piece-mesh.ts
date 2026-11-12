/**
 * Shared 3D geometry for assembly pieces. Used by the live 3D view and by the
 * 3D model export, so the downloaded file matches what is on screen.
 * Units are millimetres; the assembly floor is the XZ plane, Y is up.
 */
import type * as ThreeModule from "three";
import { pieceHoles, placement, slabCrop, type Piece, type Slab } from "@/lib/model";
import { containsPolygon, pieceOutline } from "@/lib/shapes";
import { edgeCutsOf, hasMitre, mitredFaces } from "@/lib/edges";

type Three = typeof ThreeModule;

type V2 = ThreeModule.Vector2;

/**
 * Solid with different top and bottom faces (45° mitres slant the walls on
 * mitred edges). Top and bottom outlines correspond vertex by vertex.
 * Groups: 0 = top and bottom faces (stone), 1 = walls (edge material).
 */
function mitredSolid(THREE: Three, top: V2[], bottom: V2[], openings: V2[][], thickness: number) {
  // Contour counter-clockwise and opening clockwise, as ExtrudeGeometry does.
  if (THREE.ShapeUtils.isClockWise(top)) {
    top = [...top].reverse();
    bottom = [...bottom].reverse();
  }
  const holes = openings.map((h) => (THREE.ShapeUtils.isClockWise(h) ? h : [...h].reverse()));
  const pos: number[] = [];
  const put = (p: V2, z: number) => pos.push(p.x, p.y, z);
  const cap = (contour: V2[], z: number, flip: boolean) => {
    const all = [...contour, ...holes.flat()];
    for (const f of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      const v = flip ? [f[2], f[1], f[0]] : f;
      for (const k of v) put(all[k], z);
    }
  };
  const walls = (low: V2[], high: V2[]) => {
    for (let i = 0; i < low.length; i++) {
      const j = (i + 1) % low.length;
      put(low[i], 0); put(low[j], 0); put(high[j], thickness);
      put(low[i], 0); put(high[j], thickness); put(high[i], thickness);
    }
  };
  cap(top, thickness, false);
  cap(bottom, 0, true);
  const capVerts = pos.length / 3;
  walls(bottom, top);
  for (const h of holes) walls(h, h);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  geometry.addGroup(0, capVerts, 0);
  geometry.addGroup(capVerts, pos.length / 3 - capVerts, 1);
  geometry.computeVertexNormals();
  return geometry;
}

/** Piece solid (shape, opening, mitred edges) textured from its slab photo. */
export function buildPieceGeometry(THREE: Three, piece: Piece, slab: Slab) {
  // Outline and opening come from the shared shape engine (y flipped: the
  // 3D shape is drawn in the XY plane and then laid flat).
  const outline = pieceOutline(piece);
  // Only openings fully inside the piece can be cut (others are flagged).
  const holes = pieceHoles(piece).filter((h) => containsPolygon(outline, h));
  const v2 = (q: { x: number; y: number }) => new THREE.Vector2(q.x, -q.y);
  let geometry: ThreeModule.BufferGeometry;
  if (hasMitre(piece)) {
    const faces = mitredFaces(outline, edgeCutsOf(piece), slab.thickness);
    geometry = mitredSolid(THREE, faces.top.map(v2), faces.bottom.map(v2), holes.map((h) => h.map(v2)), slab.thickness);
  } else {
    const shape = new THREE.Shape(outline.map(v2));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(v2)));
    geometry = new THREE.ExtrudeGeometry(shape, { depth: slab.thickness, bevelEnabled: false, steps: 1 });
  }
  // Map piece millimetres to where the piece sits on the slab photo (honouring
  // its rotation on the slab and the photo crop) so the veins match the layout.
  const onSlab = placement(piece).slab;
  const positions = geometry.getAttribute("position"),
    uv = geometry.getAttribute("uv"),
    crop = slabCrop(slab);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = -positions.getY(i);
    const { x: px, y: sy } = onSlab({ x, y });
    // A book-matched slab shows its photo mirrored left–right.
    const sx = slab.mirror ? slab.w - px : px;
    uv.setXY(i, crop.x + (sx / slab.w) * crop.w, 1 - (crop.y + (sy / slab.h) * crop.h));
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Position and rotate a piece object from its assembly values. */
export function applyPiecePose(THREE: Three, object: ThreeModule.Object3D, piece: Piece) {
  object.position.set(piece.ax, piece.az ?? 0, piece.ay);
  const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const turn = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(piece.rx ?? 0),
      -THREE.MathUtils.degToRad(piece.rz ?? 0),
      THREE.MathUtils.degToRad(piece.ry ?? 0),
      "YXZ",
    ),
  );
  object.quaternion.copy(turn.multiply(base));
}
