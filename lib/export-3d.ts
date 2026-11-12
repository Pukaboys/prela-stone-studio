/**
 * Export the 3D assembly as a model file.
 *
 * - GLB (glTF binary): opens in Windows 3D Viewer, Blender, SketchUp,
 *   three.js / Babylon viewers. Stone texture on faces, plain stone edges.
 * - USDZ: Apple's format; opens in AR Quick Look on iPhone / iPad.
 *   USDZ allows one material per mesh, so the texture also covers the edges.
 *
 * Both files use metres (the editor works in millimetres), Y up.
 */
import type { Project } from "@/lib/model";
import { applyPiecePose, buildPieceGeometry } from "@/lib/piece-mesh";

export type ModelFormat = "glb" | "usdz";

export async function exportAssembly(project: Project, format: ModelFormat): Promise<Blob> {
  if (!project.pieces.length) throw Error("Add pieces before exporting a 3D model.");
  const THREE = await import("three");

  // Load every slab photo first; exporters need decoded images.
  const loader = new THREE.TextureLoader();
  const textures = new Map<string, InstanceType<typeof THREE.Texture>>();
  await Promise.all(
    project.slabs
      .filter((s) => project.pieces.some((p) => p.slab === s.id))
      .map(async (slab) => {
        try {
          const texture = await loader.loadAsync(slab.image);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.userData.mimeType = "image/jpeg"; // keep the GLB small
          textures.set(slab.id, texture);
        } catch {
          throw Error(`Could not load the photo for slab “${slab.name}”.`);
        }
      }),
  );

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = project.name || "Jeo Stone Studio assembly";
  root.scale.setScalar(0.001); // mm → m
  scene.add(root);

  const edge = new THREE.MeshStandardMaterial({ name: "Stone edge", color: "#b8b7ae", roughness: 0.8 });
  const faces = new Map<string, InstanceType<typeof THREE.MeshStandardMaterial>>();
  for (const piece of project.pieces) {
    const slab = project.slabs.find((s) => s.id === piece.slab);
    if (!slab) continue;
    let top = faces.get(slab.id);
    if (!top) {
      top = new THREE.MeshStandardMaterial({
        name: slab.name,
        map: textures.get(slab.id) ?? null,
        roughness: 0.55,
        metalness: 0,
      });
      faces.set(slab.id, top);
    }
    const geometry = buildPieceGeometry(THREE, piece, slab);
    const mesh = new THREE.Mesh(geometry, format === "glb" ? [top, edge] : top);
    mesh.name = piece.name;
    applyPiecePose(THREE, mesh, piece);
    root.add(mesh);
  }

  // Sit the model on the floor at the origin so viewers frame it nicely.
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -box.min.y, -center.z);
  scene.updateMatrixWorld(true);

  try {
    if (format === "glb") {
      const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
      const result = await new GLTFExporter().parseAsync(scene, {
        binary: true,
        maxTextureSize: 4096,
      });
      return new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
    }
    const { USDZExporter } = await import("three/addons/exporters/USDZExporter.js");
    const data = await new USDZExporter().parseAsync(scene, { quickLookCompatible: true });
    return new Blob([data as BlobPart], { type: "model/vnd.usdz+zip" });
  } finally {
    scene.traverse((o) => {
      if ((o as InstanceType<typeof THREE.Mesh>).isMesh) (o as InstanceType<typeof THREE.Mesh>).geometry.dispose();
    });
    edge.dispose();
    faces.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }
}
