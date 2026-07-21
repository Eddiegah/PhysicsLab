"use client";
/**
 * ClothCanvas.tsx
 *
 * Full-screen Three.js cloth simulation scene.
 * Handles:
 *   - Three.js scene/camera/renderer setup
 *   - ClothSimulation lifecycle and per-frame stepping
 *   - Mouse picking for cloth grabbing/dragging
 *   - Lighting, environment, and post-processing
 *   - Responsive resize
 */

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { ClothSimulation, type ClothConfig } from "@/lib/cloth/ClothSimulation";

interface ClothCanvasProps {
  config: Partial<ClothConfig>;
  wireframe: boolean;
  onFpsUpdate?: (fps: number) => void;
}

export default function ClothCanvas({ config, wireframe, onFpsUpdate }: ClothCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const simRef = useRef<ClothSimulation | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const fpsRef = useRef({ frames: 0, lastTime: 0 });

  // Mouse interaction
  const mouseRef = useRef({ x: 0, y: 0, down: false });
  const raycasterRef = useRef(new THREE.Raycaster());
  const dragPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));

  // ── Setup ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = window.innerWidth;
    const h = window.innerHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0x050510);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);
    scene.fog = new THREE.Fog(0x050510, 20, 60);
    sceneRef.current = scene;

    // Camera — slightly above and back, looking at cloth
    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100);
    camera.position.set(0, 4, 14);
    camera.lookAt(0, 2, 0);
    cameraRef.current = camera;

    // ── Lighting ────────────────────────────────────────────────────────────

    // Ambient: soft fill
    const ambient = new THREE.AmbientLight(0x334466, 1.0);
    scene.add(ambient);

    // Key light: warm, soft shadows
    const keyLight = new THREE.DirectionalLight(0xffeedd, 3.0);
    keyLight.position.set(5, 15, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 50;
    keyLight.shadow.camera.left = -15;
    keyLight.shadow.camera.right = 15;
    keyLight.shadow.camera.top = 15;
    keyLight.shadow.camera.bottom = -15;
    scene.add(keyLight);

    // Rim light: cool backlight for depth
    const rimLight = new THREE.DirectionalLight(0x4488ff, 1.5);
    rimLight.position.set(-8, 5, -10);
    scene.add(rimLight);

    // Sphere point light: makes the collision object glow
    const sphereLight = new THREE.PointLight(0x6644ff, 3, 10);
    sphereLight.position.set(0, 0.5, 0);
    scene.add(sphereLight);

    // ── Floor ───────────────────────────────────────────────────────────────

    const floorGeo = new THREE.PlaneGeometry(40, 40);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a1a,
      roughness: 0.9,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3;
    floor.receiveShadow = true;
    scene.add(floor);

    // ── Grid lines on floor ──────────────────────────────────────────────────

    const gridHelper = new THREE.GridHelper(30, 30, 0x1a1a3a, 0x1a1a3a);
    gridHelper.position.y = -2.99;
    scene.add(gridHelper);

    // ── Cloth simulation ────────────────────────────────────────────────────

    const sim = new ClothSimulation(config);
    simRef.current = sim;
    scene.add(sim.mesh);
    scene.add(sim.sphereMesh);

    // Update drag plane to face camera
    dragPlaneRef.current.normal.copy(camera.position).normalize();

    // ── Render loop ─────────────────────────────────────────────────────────

    const animate = (timestamp: number) => {
      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 1 / 30);
      lastTimeRef.current = timestamp;

      // FPS
      const fps = fpsRef.current;
      fps.frames++;
      if (timestamp - fps.lastTime >= 1000) {
        onFpsUpdate?.(fps.frames);
        fps.frames = 0;
        fps.lastTime = timestamp;
      }

      sim.step(dt);
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };

    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(animate);

    // ── Resize ──────────────────────────────────────────────────────────────

    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      sim.dispose();
      container.removeChild(renderer.domElement);
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      simRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Config sync
  useEffect(() => {
    simRef.current?.updateConfig(config);
  }, [config]);

  // Wireframe sync
  useEffect(() => {
    simRef.current?.setWireframe(wireframe);
  }, [wireframe]);

  // ── Mouse Interaction ──────────────────────────────────────────────────────

  const getMouseRay = useCallback((clientX: number, clientY: number) => {
    const camera = cameraRef.current;
    if (!camera) return null;

    const x = (clientX / window.innerWidth) * 2 - 1;
    const y = -(clientY / window.innerHeight) * 2 + 1;

    const raycaster = raycasterRef.current;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    return raycaster;
  }, []);

  const getWorldPosition = useCallback((clientX: number, clientY: number) => {
    const raycaster = getMouseRay(clientX, clientY);
    if (!raycaster) return null;
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlaneRef.current, target);
    return target;
  }, [getMouseRay]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    mouseRef.current.down = true;
    const worldPos = getWorldPosition(e.clientX, e.clientY);
    if (worldPos) simRef.current?.grabParticle(worldPos);
  }, [getWorldPosition]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!mouseRef.current.down) return;
    const worldPos = getWorldPosition(e.clientX, e.clientY);
    if (worldPos) simRef.current?.moveDrag(worldPos);
  }, [getWorldPosition]);

  const onMouseUp = useCallback(() => {
    mouseRef.current.down = false;
    simRef.current?.releaseDrag();
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const t = e.touches[0];
      const worldPos = getWorldPosition(t.clientX, t.clientY);
      if (worldPos) simRef.current?.grabParticle(worldPos);
    }
  }, [getWorldPosition]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const t = e.touches[0];
      const worldPos = getWorldPosition(t.clientX, t.clientY);
      if (worldPos) simRef.current?.moveDrag(worldPos);
    }
  }, [getWorldPosition]);

  const onTouchEnd = useCallback(() => {
    simRef.current?.releaseDrag();
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      style={{ touchAction: "none" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    />
  );
}
