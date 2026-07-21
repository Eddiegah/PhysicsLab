"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ClothSimulation, type ClothConfig } from "@/lib/cloth/ClothSimulation";

interface Props {
  config: Partial<ClothConfig>;
  wireframe: boolean;
  onFpsUpdate?: (fps: number) => void;
}

export default function ClothCanvas({ config, wireframe, onFpsUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef       = useRef<ClothSimulation | null>(null);
  const cfgRef       = useRef(config);
  const wfRef        = useRef(wireframe);
  const fpsRef       = useRef(onFpsUpdate);
  cfgRef.current     = config;
  wfRef.current      = wireframe;
  fpsRef.current     = onFpsUpdate;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = window.innerWidth, h = window.innerHeight;

    // ── Renderer ───────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.setClearColor(0x07070f);
    container.appendChild(renderer.domElement);

    // ── Scene ──────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07070f);
    scene.fog = new THREE.FogExp2(0x07070f, 0.045);

    // ── Camera ─────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(52, w/h, 0.1, 100);
    camera.position.set(0, 5, 13);
    camera.lookAt(0, 2, 0);

    // ── Lights ─────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x334466, 1.2));

    const sun = new THREE.DirectionalLight(0xfff5e0, 3.5);
    sun.position.set(6, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.002;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x4488ff, 1.2);
    fill.position.set(-8, 4, -10);
    scene.add(fill);

    // Sphere glow
    const sphereGlow = new THREE.PointLight(0x6655ff, 5, 8, 1.5);
    sphereGlow.position.set(0, 0.5, 0);
    scene.add(sphereGlow);

    // ── Floor ──────────────────────────────────────────────────────────────
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({ color: 0x080815, roughness: 1.0 })
    );
    floor.rotation.x = -Math.PI/2;
    floor.position.y = -3.0;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(30, 30, 0x1a1a3a, 0x121228);
    grid.position.y = -2.99;
    scene.add(grid);

    // ── Pin indicators — thin lines showing where cloth is pinned ──────────
    const pinGeo = new THREE.CylinderGeometry(0.04, 0.04, 8, 8);
    const pinMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff8800, emissiveIntensity: 0.5 });
    const half = 6/2;
    [-half, half].forEach(px => {
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.position.set(px, 5.5, -half); // top corners
      scene.add(pin);
    });

    // ── Cloth ──────────────────────────────────────────────────────────────
    const sim = new ClothSimulation(config);
    simRef.current = sim;
    scene.add(sim.mesh);
    scene.add(sim.sphereMesh);

    // ── Mouse drag ─────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    let dragging = false;

    const screenToRay = (clientX: number, clientY: number) => {
      const x =  (clientX / window.innerWidth ) * 2 - 1;
      const y = -(clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      return raycaster;
    };
    const rayWorldPos = (clientX: number, clientY: number) => {
      const r = screenToRay(clientX, clientY);
      const t = new THREE.Vector3();
      r.ray.intersectPlane(dragPlane, t);
      return t;
    };

    const onMouseDown = (e: MouseEvent) => {
      dragging = true;
      sim.grab(rayWorldPos(e.clientX, e.clientY));
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      sim.drag(rayWorldPos(e.clientX, e.clientY));
    };
    const onMouseUp = () => { dragging = false; sim.release(); };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      sim.grab(rayWorldPos(t.clientX, t.clientY));
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      sim.drag(rayWorldPos(t.clientX, t.clientY));
    };
    const onTouchEnd = () => sim.release();

    renderer.domElement.addEventListener("mousedown",  onMouseDown);
    window.addEventListener("mousemove",  onMouseMove);
    window.addEventListener("mouseup",    onMouseUp);
    renderer.domElement.addEventListener("touchstart", onTouchStart, { passive: false });
    renderer.domElement.addEventListener("touchmove",  onTouchMove,  { passive: false });
    renderer.domElement.addEventListener("touchend",   onTouchEnd);

    // ── Loop ───────────────────────────────────────────────────────────────
    let raf = 0, lastT = 0, fpsF = 0, fpsL = 0;

    const tick = (t: number) => {
      const dt = Math.min((t - lastT) / 1000, 1/30);
      lastT = t;

      sim.updateConfig(cfgRef.current);
      sim.setWireframe(wfRef.current);

      fpsF++;
      if (t - fpsL > 1000) { fpsRef.current?.(fpsF); fpsF=0; fpsL=t; }

      sim.step(dt);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };

    lastT = performance.now(); fpsL = performance.now();
    raf = requestAnimationFrame(tick);

    // ── Resize ─────────────────────────────────────────────────────────────
    const onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      camera.aspect = w/h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize",    onResize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
      renderer.domElement.removeEventListener("mousedown",  onMouseDown);
      renderer.domElement.removeEventListener("touchstart", onTouchStart);
      renderer.domElement.removeEventListener("touchmove",  onTouchMove);
      renderer.domElement.removeEventListener("touchend",   onTouchEnd);
      renderer.dispose();
      sim.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      simRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-full h-full"
      style={{ cursor: "grab", touchAction: "none" }}
    />
  );
}
