/**
 * Shared 3D geometry for assembly pieces. Used by the live 3D view and by the
 * 3D model export, so the downloaded file matches what is on screen.
 * Units are millimetres; the assembly floor is the XZ plane, Y is up.
 */
import type * as ThreeModule from "three";
import { opening, slabCrop, type Piece, type Slab } from "@/lib/model";

type Three = typeof ThreeModule;

/** Extruded piece (with opening and optional 45° edge) textured from its slab photo. */
export function buildPieceGeometry(THREE: Three, piece: Piece, slab: Slab) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, -piece.h);
  shape.lineTo(piece.w, -piece.h);
  shape.lineTo(piece.w, 0);
  shape.closePath();
  const hole = opening(piece);
  if (
    hole.w > 0 &&
    hole.h > 0 &&
    hole.x >= 0 &&
    hole.y >= 0 &&
    hole.x + hole.w <= piece.w &&
    hole.y + hole.h <= piece.h
  ) {
    const path = new THREE.Path();
    path.moveTo(hole.x, -hole.y);
    path.lineTo(hole.x + hole.w, -hole.y);
    path.lineTo(hole.x + hole.w, -hole.y - hole.h);
    path.lineTo(hole.x, -hole.y - hole.h);
    path.closePath();
    shape.holes.push(path);
  }
  const bevel = piece.cutAngle === 45 ? Math.min(slab.thickness / 2, 10) : 0;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: slab.thickness,
    bevelEnabled: bevel > 0,
    bevelSegments: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
    steps: 1,
  });
  // Map piece millimetres to where the piece sits on the slab photo (honouring
  // the 90° rotation and the photo crop) so the veins match the slab layout.
  const positions = geometry.getAttribute("position"),
    uv = geometry.getAttribute("uv"),
    crop = slabCrop(slab);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = -positions.getY(i);
    const sx = piece.rot ? piece.x + piece.h - y : piece.x + x;
    const sy = piece.rot ? piece.y + x : piece.y + y;
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
