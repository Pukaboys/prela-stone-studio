"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, Piece } from "@/lib/model";
import { opening, slabCrop } from "@/lib/model";

type Props = {
  project: Project;
  selected: string;
  onSelect: (id: string) => void;
  onMoveStart: () => void;
  onMove: (id: string, ax: number, ay: number) => void;
  onTransform: (id: string, values: Partial<Piece>) => void;
};

export default function Assembly3D({
  project,
  selected,
  onSelect,
  onMoveStart,
  onMove,
  onTransform,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const latest = useRef({
    project,
    selected,
    onMoveStart,
    onMove,
    onTransform,
  });
  latest.current = { project, selected, onMoveStart, onMove, onTransform };
  const sync = useRef<() => void>(() => {});
  const [mode, setMode] = useState<"move" | "height" | "rotate" | "orbit">(
    "move",
  );
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const geometryKey = JSON.stringify({
    id: project.id,
    slabs: project.slabs,
    pieces: project.pieces.map((p) => ({
      ...p,
      ax: 0,
      ay: 0,
      az: 0,
      rx: 0,
      ry: 0,
      rz: 0,
    })),
  });
  useEffect(() => {
    sync.current();
  }, [project, selected]);
  const reset = useRef<() => void>(() => {});
  const pose = useRef<{ position: number[]; target: number[] } | null>(null);
  const [error, setError] = useState("");
  const [textureError, setTextureError] = useState(false);
  useEffect(() => {
    let stopped = false,
      cleanup = () => {};
    setError("");
    setTextureError(false);
    async function init() {
      const THREE = await import("three");
      const { OrbitControls } =
        await import("three/addons/controls/OrbitControls.js");
      if (stopped || !host.current) return;
      const container = host.current;
      const { project, selected } = latest.current;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } catch {
        setError("3D is unavailable in this browser. Switch to 2D assembly.");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);
      renderer.domElement.setAttribute(
        "aria-label",
        "3D stone assembly. In Move mode, drag a piece to reposition it. Arrow keys move the selected piece. Scroll to zoom, right-drag to pan.",
      );
      renderer.domElement.tabIndex = 0;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#151b1f");
      const camera = new THREE.PerspectiveCamera(42, 1, 1, 500000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI / 2 - 0.02;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x687078, 2.4));
      const light = new THREE.DirectionalLight(0xffffff, 2);
      light.position.set(-2000, 6000, 2500);
      scene.add(light);
      const group = new THREE.Group();
      scene.add(group);
      const textures: InstanceType<typeof THREE.Texture>[] = [];
      const geometries: InstanceType<typeof THREE.BufferGeometry>[] = [];
      const materials: InstanceType<typeof THREE.Material>[] = [];
      const loader = new THREE.TextureLoader();
      const bySlab = new Map<string, InstanceType<typeof THREE.Texture>>();
      for (const slab of project.slabs) {
        const texture = loader.load(
          slab.image,
          () => {
            if (stopped) texture.dispose();
          },
          undefined,
          () => {
            if (!stopped) setTextureError(true);
          },
        );
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        textures.push(texture);
        bySlab.set(slab.id, texture);
      }
      for (const piece of project.pieces) {
        const slab = project.slabs.find((s) => s.id === piece.slab);
        if (!slab) continue;
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
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: slab.thickness,
        bevelEnabled: piece.cutAngle === 45,
        bevelSegments: 1,
        bevelSize: piece.cutAngle === 45 ? Math.min(slab.thickness / 2, 10) : 0,
        bevelThickness: piece.cutAngle === 45 ? Math.min(slab.thickness / 2, 10) : 0,
        steps: 1,
      });
        const positions = geometry.getAttribute("position"),
          uv = geometry.getAttribute("uv"),
          crop = slabCrop(slab);
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i),
            y = -positions.getY(i);
          const sx = piece.rot ? piece.x + piece.h - y : piece.x + x;
          const sy = piece.rot ? piece.y + x : piece.y + y;
          // Map slab millimetres into the cropped region of the photo so the
          // 3D veins match what the slab layout shows.
          uv.setXY(
            i,
            crop.x + (sx / slab.w) * crop.w,
            1 - (crop.y + (sy / slab.h) * crop.h),
          );
        }
        uv.needsUpdate = true;
        geometries.push(geometry);
        const top = new THREE.MeshStandardMaterial({
          map: bySlab.get(slab.id),
          roughness: 0.55,
          metalness: 0,
        });
        const edge = new THREE.MeshStandardMaterial({
          color: "#b8b7ae",
          roughness: 0.8,
        });
        materials.push(top, edge);
        const mesh = new THREE.Mesh(geometry, [top, edge]);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(piece.ax, 0, piece.ay);
        mesh.userData.pieceId = piece.id;
        group.add(mesh);
        const outlineGeometry = new THREE.EdgesGeometry(geometry);
        const outlineMaterial = new THREE.LineBasicMaterial({
          color: piece.id === selected ? piece.color : "#767d7e",
        });
        geometries.push(outlineGeometry);
        materials.push(outlineMaterial);
        const outline = new THREE.LineSegments(
          outlineGeometry,
          outlineMaterial,
        );
        mesh.add(outline);
      }
      function applyPose(
        object: InstanceType<typeof THREE.Object3D>,
        piece: Piece,
      ) {
        object.position.set(piece.ax, piece.az ?? 0, piece.ay);
        const base = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          -Math.PI / 2,
        );
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
      sync.current = () => {
        for (const object of group.children) {
          const piece = latest.current.project.pieces.find(
            (p) => p.id === object.userData.pieceId,
          );
          if (!piece) continue;
          applyPose(object, piece);
          const outline = object.children[0] as InstanceType<
            typeof THREE.LineSegments
          >;
          (
            outline.material as InstanceType<typeof THREE.LineBasicMaterial>
          ).color.set(
            piece.id === latest.current.selected ? piece.color : "#767d7e",
          );
        }
      };
      sync.current();
      const bounds = new THREE.Box3().setFromObject(group);
      const center = bounds.isEmpty()
        ? new THREE.Vector3(1000, 0, 750)
        : bounds.getCenter(new THREE.Vector3());
      const size = bounds.isEmpty()
        ? new THREE.Vector3(2000, 20, 1500)
        : bounds.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 1000);
      const gridSize = Math.ceil((span * 2) / 500) * 500;
      const grid = new THREE.GridHelper(
        gridSize,
        Math.min(100, gridSize / 100),
        0x45575d,
        0x26383f,
      );
      grid.position.set(center.x, -2, center.z);
      scene.add(grid);
      geometries.push(grid.geometry);
      if (Array.isArray(grid.material)) materials.push(...grid.material);
      else materials.push(grid.material);
      function fit() {
        group.updateMatrixWorld(true);
        const currentBounds = new THREE.Box3().setFromObject(group);
        const currentCenter = currentBounds.isEmpty()
          ? center
          : currentBounds.getCenter(new THREE.Vector3());
        const currentSize = currentBounds.isEmpty()
          ? size
          : currentBounds.getSize(new THREE.Vector3());
        const span = Math.max(
          currentSize.x,
          currentSize.y,
          currentSize.z,
          1000,
        );
        const distance =
          ((span / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) *
            1.35) /
          Math.min(camera.aspect, 1);
        camera.position.set(
          currentCenter.x + distance * 0.6,
          currentCenter.y + distance * 0.85,
          currentCenter.z + distance * 0.8,
        );
        controls.target.copy(currentCenter);
        controls.update();
      }
      const resize = new ResizeObserver(() => {
        const w = container.clientWidth,
          h = container.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      });
      resize.observe(container);
      camera.aspect =
        container.clientWidth / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      if (pose.current) {
        camera.position.fromArray(pose.current.position);
        controls.target.fromArray(pose.current.target);
        controls.update();
      } else fit();
      reset.current = fit;
      const raycaster = new THREE.Raycaster(),
        pointer = new THREE.Vector2();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
        intersection = new THREE.Vector3();
      let down = { x: 0, y: 0 };
      let drag: {
        pointerId: number;
        mesh: InstanceType<typeof THREE.Object3D>;
        origin: InstanceType<typeof THREE.Vector3>;
        ax: number;
        ay: number;
        az: number;
        rz: number;
        screenX: number;
        mode: string;
        recorded: boolean;
      } | null = null;
      function cast(event: PointerEvent) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld();
        raycaster.setFromCamera(pointer, camera);
      }
      const start = (event: PointerEvent) => {
        if (drag) return;
        down = { x: event.clientX, y: event.clientY };
        if (event.button !== 0 || modeRef.current === "orbit") return;
        cast(event);
        const hit = raycaster.intersectObjects(group.children, false)[0];
        if (!hit) return;
        if (modeRef.current === "height") {
          const normal = camera.getWorldDirection(new THREE.Vector3());
          normal.y = 0;
          if (normal.lengthSq() < 0.0001) normal.set(0, 0, 1);
          plane.setFromNormalAndCoplanarPoint(normal.normalize(), hit.point);
        } else
          plane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 1, 0),
            hit.point,
          );
        if (!raycaster.ray.intersectPlane(plane, intersection)) return;
        drag = {
          pointerId: event.pointerId,
          mesh: hit.object,
          origin: intersection.clone(),
          ax: hit.object.position.x,
          ay: hit.object.position.z,
          az: hit.object.position.y,
          rz:
            latest.current.project.pieces.find(
              (p) => p.id === hit.object.userData.pieceId,
            )?.rz ?? 0,
          screenX: event.clientX,
          mode: modeRef.current,
          recorded: false,
        };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        renderer.domElement.style.cursor = "grabbing";
        renderer.domElement.focus();
        select.current(hit.object.userData.pieceId);
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const move = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (drag.mode === "rotate") {
          const rz = Math.max(
            -360,
            Math.min(
              360,
              Math.round(drag.rz + (event.clientX - drag.screenX) * 0.5),
            ),
          );
          const piece = latest.current.project.pieces.find(
            (p) => p.id === drag!.mesh.userData.pieceId,
          );
          if (!piece || rz === (piece.rz ?? 0)) return;
          if (!drag.recorded) {
            latest.current.onMoveStart();
            drag.recorded = true;
          }
          applyPose(drag.mesh, { ...piece, rz });
          latest.current.onTransform(piece.id, { rz });
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        cast(event);
        if (!raycaster.ray.intersectPlane(plane, intersection)) return;
        if (drag.mode === "height") {
          const az = Math.max(
            0,
            Math.min(
              50000,
              Math.round((drag.az + intersection.y - drag.origin.y) / 5) * 5,
            ),
          );
          if (az === drag.mesh.position.y) return;
          if (!drag.recorded) {
            latest.current.onMoveStart();
            drag.recorded = true;
          }
          drag.mesh.position.y = az;
          latest.current.onTransform(drag.mesh.userData.pieceId, { az });
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const ax = Math.max(
          0,
          Math.min(
            50000,
            Math.round((drag.ax + intersection.x - drag.origin.x) / 5) * 5,
          ),
        );
        const ay = Math.max(
          0,
          Math.min(
            50000,
            Math.round((drag.ay + intersection.z - drag.origin.z) / 5) * 5,
          ),
        );
        if (ax === drag.mesh.position.x && ay === drag.mesh.position.z) return;
        if (!drag.recorded) {
          latest.current.onMoveStart();
          drag.recorded = true;
        }
        drag.mesh.position.x = ax;
        drag.mesh.position.z = ay;
        latest.current.onMove(drag.mesh.userData.pieceId, ax, ay);
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const finish = (event: PointerEvent) => {
        if (drag && event.pointerId === drag.pointerId) {
          drag = null;
          controls.enabled = true;
          renderer.domElement.style.cursor = "";
          if (renderer.domElement.hasPointerCapture(event.pointerId))
            renderer.domElement.releasePointerCapture(event.pointerId);
          event.stopImmediatePropagation();
          return;
        }
        if (
          event.type !== "pointerup" ||
          event.button !== 0 ||
          Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5
        )
          return;
        cast(event);
        const hit = raycaster.intersectObjects(group.children, false)[0];
        if (hit) select.current(hit.object.userData.pieceId);
      };
      const keys = (event: KeyboardEvent) => {
        const directions: Record<string, number[]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const direction = directions[event.key];
        const rotateShortcut = event.key.toLowerCase() === "r";
        const axisShortcut = ["x", "y", "z"].includes(event.key.toLowerCase());
        if (!direction && !["PageUp", "PageDown"].includes(event.key) && !rotateShortcut && !axisShortcut) return;
        const piece = latest.current.project.pieces.find(
          (p) => p.id === latest.current.selected,
        );
        if (!piece) return;
        event.preventDefault();
        const step = event.shiftKey ? 50 : 5;
        latest.current.onMoveStart();
        if (rotateShortcut) {
          const amount = event.shiftKey ? -45 : 45;
          latest.current.onTransform(piece.id, { rz: ((piece.rz ?? 0) + amount + 360) % 360 });
          return;
        }
        if (axisShortcut) {
          const amount = event.shiftKey ? -5 : 5;
          const key = { x: "rx", y: "ry", z: "rz" }[event.key.toLowerCase()] as "rx" | "ry" | "rz";
          latest.current.onTransform(piece.id, { [key]: Math.max(-360, Math.min(360, (piece[key] ?? 0) + amount)) });
          return;
        }
        if (event.key === "PageUp" || event.key === "PageDown") {
          latest.current.onTransform(piece.id, {
            az: Math.max(
              0,
              Math.min(
                50000,
                (piece.az ?? 0) + (event.key === "PageUp" ? step : -step),
              ),
            ),
          });
          return;
        }
        latest.current.onMove(
          piece.id,
          Math.max(0, Math.min(50000, piece.ax + direction[0] * step)),
          Math.max(0, Math.min(50000, piece.ay + direction[1] * step)),
        );
      };
      renderer.domElement.addEventListener("pointerdown", start, true);
      renderer.domElement.addEventListener("pointermove", move, true);
      renderer.domElement.addEventListener("pointerup", finish, true);
      renderer.domElement.addEventListener("pointercancel", finish, true);
      renderer.domElement.addEventListener("lostpointercapture", finish, true);
      renderer.domElement.addEventListener("keydown", keys);
      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
      });
      cleanup = () => {
        pose.current = {
          position: camera.position.toArray(),
          target: controls.target.toArray(),
        };
        reset.current = () => {};
        resize.disconnect();
        renderer.setAnimationLoop(null);
        sync.current = () => {};
        renderer.domElement.removeEventListener("pointerdown", start, true);
        renderer.domElement.removeEventListener("pointermove", move, true);
        renderer.domElement.removeEventListener("pointerup", finish, true);
        renderer.domElement.removeEventListener("pointercancel", finish, true);
        renderer.domElement.removeEventListener(
          "lostpointercapture",
          finish,
          true,
        );
        renderer.domElement.removeEventListener("keydown", keys);
        controls.dispose();
        for (const g of geometries) g.dispose();
        for (const m of materials) m.dispose();
        for (const t of textures) t.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }
    init().catch(() => {
      if (!stopped)
        setError("Could not load 3D assembly. Switch to 2D and try again.");
    });
    return () => {
      stopped = true;
      cleanup();
    };
  }, [geometryKey]);
  return (
    <div className="assembly-3d">
      <div ref={host} className="assembly-3d-field" />
      {error && (
        <p className="assembly-3d-message" role="alert">
          {error}
        </p>
      )}
      {textureError && (
        <p className="assembly-3d-message" role="alert">
          A slab photo could not load. Check the image in 2D.
        </p>
      )}
      {!project.pieces.length && (
        <p className="assembly-3d-message">
          Add pieces to see the 3D assembly.
        </p>
      )}
      <div
        className="assembly-3d-mode"
        role="group"
        aria-label="3D interaction mode"
      >
        <button aria-pressed={mode === "move"} onClick={() => setMode("move")}>
          Move pieces
        </button>
        <button
          aria-pressed={mode === "height"}
          onClick={() => setMode("height")}
        >
          Move Z
        </button>
        <button
          aria-pressed={mode === "rotate"}
          onClick={() => setMode("rotate")}
        >
          Rotate Z
        </button>
        <button
          aria-pressed={mode === "orbit"}
          onClick={() => setMode("orbit")}
        >
          Orbit camera
        </button>
      </div>
      <p className="assembly-3d-shortcut">X/Y/Z rotate +5° · Shift+X/Y/Z rotate −5° · R rotates Z by 45°</p>
      <p className="assembly-3d-help">
        {mode === "move"
          ? "Drag to move X/Y · PageUp/Down: Z"
          : mode === "height"
            ? "Drag a piece vertically to move Z"
            : mode === "rotate"
              ? "Drag a piece left/right to turn Z"
              : "Drag to orbit camera"}{" "}
        · Scroll to zoom · Right-drag to pan
      </p>
      <button className="assembly-3d-reset" onClick={() => reset.current()}>
        Fit 3D view
      </button>
    </div>
  );
}
