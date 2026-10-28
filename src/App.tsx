/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BlockLayout,
  PieceId,
  SpringState,
  ShatterTrajectory,
  computeBlockLayout,
  getCutCells,
  insetPolygonCCW,
  polygonCentroid,
  buildRoundedPolygonPoints,
  stepSpring,
  computeHoverTip,
  easeInCubic,
  easeOutBack,
  createShatterTrajectories,
  evaluateShatterPose,
  getBackSliverPolygon,
} from './utils/glassMath';
import { computeHomographyMatrix3d, Point2D } from './utils/homography';
import {
  InteractiveHoverState,
  computePanelMetrics,
  drawPanelCanvas,
  drawNavCanvas,
  drawBackSliverCanvas,
} from './components/CanvasTextures';
import { DefinitionsView } from './components/DefinitionsView';
import { ActivePortalMode } from './components/CircuitCityOverlay';
import { TejprakashWorkspace } from './components/TejprakashWorkspace';
import { StaticFallback } from './components/StaticFallback';
import { verifyAdminPassword } from './utils/tejprakashLogic';

type ViewPhase = 'entering' | 'hero' | 'shattering' | 'paper' | 'reassembling';

interface PieceRuntime {
  id: PieceId;
  group: THREE.Group;
  glassMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  printMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  restCenter: Point2D;
  approxRadius: number;
  liftSpring: SpringState;
  rotXSpring: SpringState;
  rotYSpring: SpringState;
  sheenSpring: SpringState;
}

const SYSTEM_PRESETS = [
  { name: 'Dual DC Fans Ready', color: 0x17171b, iridescence: 0.55, roughness: 0.36 },
  { name: 'Camera Node Active', color: 0x151821, iridescence: 0.72, roughness: 0.32 },
  { name: 'AI Auto (1–4 Persons)', color: 0x141d1b, iridescence: 0.82, roughness: 0.3 },
  { name: 'Manual Override (Fan 1 & 2)', color: 0x1b1622, iridescence: 0.68, roughness: 0.34 },
];

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const domOverlayRef = useRef<HTMLDivElement | null>(null);
  const workspaceWrapRef = useRef<HTMLDivElement | null>(null);

  const [fallbackMode, setFallbackMode] = useState(false);
  const [viewport, setViewport] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 960,
  }));

  const [phaseState, setPhaseState] = useState<ViewPhase>('entering');
  const [portalMode, setPortalMode] = useState<ActivePortalMode>('controller');
  const [definitionsOpacity, setDefinitionsOpacity] = useState(0);
  const [backHovered, setBackHovered] = useState(false);
  const [presetIndex] = useState(0);

  // Password prompt modal state for Admin Controller Login
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Fan speeds (0-100%) driven by AI Model or Manual Controller
  const [fan1Speed, setFan1Speed] = useState<number>(100);
  const [fan2Speed, setFan2Speed] = useState<number>(0);

  const handleFanSpeedChange = useCallback((f1: number, f2: number) => {
    setFan1Speed(f1);
    setFan2Speed(f2);
  }, []);

  // Mutable refs shared with the Three.js animation loop so React renders never recreate the canvas
  const phaseRef = useRef<ViewPhase>('entering');
  const portalModeRef = useRef<ActivePortalMode>('controller');
  const phaseStartTimeRef = useRef<number>(0);
  const hoverStateRef = useRef<InteractiveHoverState>({
    openStudioHovered: false,
    controllerHovered: false,
    readPaperHovered: false,
    hoveredNavLink: null,
    backHovered: false,
    activeMaterialLabel: SYSTEM_PRESETS[0].name,
  });
  const canvasDirtyRef = useRef<boolean>(true);
  const triggerShatterRef = useRef<(mode: ActivePortalMode) => void>(() => {});
  const triggerReassembleRef = useRef<() => void>(() => {});

  // Check prefers-reduced-motion or WebGL support
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
      setFallbackMode(true);
      return;
    }
    const handleChange = (e: MediaQueryListEvent) => setFallbackMode(e.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  // 1. Clicking "Camera": shatters the glass directly into the NORVA 3D Isometric Night-City UI
  const handleCameraClick = useCallback(() => {
    setPasswordModalOpen(false);
    triggerShatterRef.current('camera');
  }, []);

  // 2. Clicking "Controller": opens the Admin Password Modal before shattering into the NORVA 3D Night-City UI
  const handleControllerClick = useCallback(() => {
    setPasswordError(null);
    setPasswordInput('');
    setPasswordModalOpen(true);
  }, []);

  const handlePasswordSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = passwordInput.trim();
      if (trimmed.length === 0) {
        setPasswordError('Please enter the controller password.');
        return;
      }
      if (!verifyAdminPassword(trimmed)) {
        setPasswordError('Incorrect password. Access restricted to authorized controller.');
        return;
      }
      setPasswordModalOpen(false);
      setPasswordError(null);
      triggerShatterRef.current('controller');
    },
    [passwordInput]
  );

  // 3. Clicking "System rules →": shatters into the 5 system rules view
  const handleReadPaperClick = useCallback(() => {
    setPasswordModalOpen(false);
    triggerShatterRef.current('rules');
  }, []);

  const handleBackClick = useCallback(() => {
    triggerReassembleRef.current();
  }, []);

  const updateHoverFlag = useCallback((patch: Partial<InteractiveHoverState>) => {
    hoverStateRef.current = { ...hoverStateRef.current, ...patch };
    canvasDirtyRef.current = true;
    if (patch.backHovered !== undefined) {
      setBackHovered(patch.backHovered);
    }
  }, []);

  useEffect(() => {
    if (fallbackMode) return;
    const container = canvasMountRef.current;
    if (!container) return;

    // Detect software WebGL (SwiftShader / llvmpipe) per threejs skill guidelines
    const isSoftwareGl = (() => {
      try {
        const probeCanvas = document.createElement('canvas');
        const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      setFallbackMode(true);
      return;
    }

    let W = window.innerWidth || 1440;
    let H = window.innerHeight || 960;
    let layout: BlockLayout = computeBlockLayout(W, H);

    renderer.setSize(W, H);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.setAttribute('data-testid', 'facet-webgl-canvas');
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Scene & Background (#050507)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050507);

    // Camera: perspective, fov 30°, placed so 1 world unit = 1 CSS px at z = 0
    const camera = new THREE.PerspectiveCamera(30, W / H, 10, 20000);
    camera.position.set(0, 0, layout.cameraZ);
    camera.lookAt(0, 0, 0);

    // Environment: PMREM RoomEnvironment, environmentIntensity .42
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    scene.environmentIntensity = 0.42;
    pmremGenerator.dispose();

    // Soft white-blue key light from the top-left + subtle rim light
    const keyLight = new THREE.DirectionalLight(0xdbe8ff, 2.75);
    keyLight.position.set(-W * 0.65, H * 0.78, 950);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x9cb8ff, 1.15);
    rimLight.position.set(W * 0.55, -H * 0.55, 650);
    scene.add(rimLight);

    const fillLight = new THREE.HemisphereLight(0xd6e2ff, 0x08080c, 0.5);
    scene.add(fillLight);

    // Shared shader uniforms for the cursor glow on the glass shards
    const cursorGlowUniforms = {
      uPointerWorld: { value: new THREE.Vector3(0, 0, 0) },
      uPointerGlow: { value: 0.0 },
      uScaleS: { value: layout.S },
    };

    function createGlassMaterial(withCursorGlow: boolean, baseIridescence = 0.55) {
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0x17171b),
        roughness: 0.36,
        metalness: 0.04,
        clearcoat: 0.7,
        clearcoatRoughness: 0.12,
        specularIntensity: 0.7,
        iridescence: baseIridescence,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [250, 650],
        envMapIntensity: 1.0,
      });

      if (withCursorGlow) {
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uPointerWorld = cursorGlowUniforms.uPointerWorld;
          shader.uniforms.uPointerGlow = cursorGlowUniforms.uPointerGlow;
          shader.uniforms.uScaleS = cursorGlowUniforms.uScaleS;

          shader.vertexShader =
            `varying vec3 vFacetWorldPos;\n` +
            shader.vertexShader.replace(
              '#include <worldpos_vertex>',
              `#include <worldpos_vertex>
               vFacetWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
            );

          shader.fragmentShader =
            `varying vec3 vFacetWorldPos;\nuniform vec3 uPointerWorld;\nuniform float uPointerGlow;\nuniform float uScaleS;\n` +
            shader.fragmentShader.replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
               float facetDist = length(vFacetWorldPos.xy - uPointerWorld.xy);
               float facetScale = max(1.0, 300.0 * uScaleS);
               float facetNorm = facetDist / facetScale;
               vec3 facetLavender = vec3(0.42, 0.37, 0.62) * 0.16 * exp(-1.6 * facetNorm * facetNorm) * uPointerGlow;
               totalEmissiveRadiance += facetLavender;`
            );
        };
      }

      return mat;
    }

    // Offscreen 2D canvases for printed shard content (DPR >= 1.5)
    const canvasDpr = Math.max(1.5, Math.min(window.devicePixelRatio || 2, 2));
    const panelCanvas = document.createElement('canvas');
    const navCanvas = document.createElement('canvas');
    const backCanvas = document.createElement('canvas');

    drawPanelCanvas(panelCanvas, layout, hoverStateRef.current, canvasDpr);
    drawNavCanvas(navCanvas, layout, hoverStateRef.current, canvasDpr);
    drawBackSliverCanvas(backCanvas, W, false);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const panelTexture = new THREE.CanvasTexture(panelCanvas);
    panelTexture.colorSpace = THREE.SRGBColorSpace;
    panelTexture.anisotropy = maxAniso;
    panelTexture.minFilter = THREE.LinearFilter;
    panelTexture.magFilter = THREE.LinearFilter;

    const navTexture = new THREE.CanvasTexture(navCanvas);
    navTexture.colorSpace = THREE.SRGBColorSpace;
    navTexture.anisotropy = maxAniso;
    navTexture.minFilter = THREE.LinearFilter;
    navTexture.magFilter = THREE.LinearFilter;

    const backTexture = new THREE.CanvasTexture(backCanvas);
    backTexture.colorSpace = THREE.SRGBColorSpace;
    backTexture.anisotropy = maxAniso;
    backTexture.minFilter = THREE.LinearFilter;
    backTexture.magFilter = THREE.LinearFilter;

    const panelPrintMaterial = new THREE.MeshBasicMaterial({
      map: panelTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });

    const navPrintMaterial = new THREE.MeshBasicMaterial({
      map: navTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });

    const backPrintMaterial = new THREE.MeshBasicMaterial({
      map: backTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });

    // Main block group (tilts toward cursor)
    const blockGroup = new THREE.Group();
    scene.add(blockGroup);

    const pieceIds: PieceId[] = ['nav', 'A', 'B', 'C', 'D', 'E'];
    const pieces: Record<PieceId, PieceRuntime> = {} as any;
    const interactableMeshes: THREE.Object3D[] = [];

    for (const id of pieceIds) {
      const group = new THREE.Group();
      const glassMat = createGlassMaterial(true, 0.55);
      const glassMesh = new THREE.Mesh(new THREE.BufferGeometry(), glassMat);
      glassMesh.userData.pieceId = id;

      const printMat = id === 'nav' ? navPrintMaterial : panelPrintMaterial;
      const printMesh = new THREE.Mesh(new THREE.BufferGeometry(), printMat);
      printMesh.position.z = 0.28;

      group.add(glassMesh);
      group.add(printMesh);
      blockGroup.add(group);

      pieces[id] = {
        id,
        group,
        glassMesh,
        printMesh,
        restCenter: { x: 0, y: 0 },
        approxRadius: 180,
        liftSpring: { value: 0, velocity: 0 },
        rotXSpring: { value: 0, velocity: 0 },
        rotYSpring: { value: 0, velocity: 0 },
        sheenSpring: { value: 0, velocity: 0 },
      };
      interactableMeshes.push(glassMesh);
    }

    // "← Back" 3D Sliver Group (used in the 5-rules view)
    const backSliverGroup = new THREE.Group();
    backSliverGroup.visible = false;
    scene.add(backSliverGroup);

    const backSliverGlassMat = createGlassMaterial(false, 0.35);
    backSliverGlassMat.envMapIntensity = 1.35;
    const backSliverMesh = new THREE.Mesh(new THREE.BufferGeometry(), backSliverGlassMat);
    backSliverMesh.userData.isBackSliver = true;

    const backSliverPrintMesh = new THREE.Mesh(new THREE.BufferGeometry(), backPrintMaterial);
    backSliverPrintMesh.position.z = 0.3;

    backSliverGroup.add(backSliverMesh);
    backSliverGroup.add(backSliverPrintMesh);

    let shatterTrajectories: Record<PieceId, ShatterTrajectory> = createShatterTrajectories(layout.S);

    function buildPieceGeometry(
      piece: PieceRuntime,
      ccwBlockPolygon: Point2D[],
      isNav: boolean
    ) {
      const S = layout.S;
      const halfGap = 7 * S;
      const bevelSize = 2.6 * S;
      const bevelThickness = 2.6 * S;
      const depth = 13 * S;
      const cornerRadius = 20 * S;

      const insetPoly = insetPolygonCCW(ccwBlockPolygon, halfGap + bevelSize);
      const center = polygonCentroid(insetPoly);
      piece.restCenter = center;

      let maxDist = 60 * S;
      for (const p of insetPoly) {
        const d = Math.hypot(p.x - center.x, p.y - center.y);
        if (d > maxDist) maxDist = d;
      }
      piece.approxRadius = maxDist * 0.65;

      const localPoly = insetPoly.map((p) => ({
        x: p.x - center.x,
        y: p.y - center.y,
      }));

      const roundedPts = buildRoundedPolygonPoints(
        localPoly,
        Math.max(2 * S, cornerRadius - bevelSize),
        7
      );

      const shape = new THREE.Shape();
      if (roundedPts.length > 0) {
        shape.moveTo(roundedPts[0].x, roundedPts[0].y);
        for (let i = 1; i < roundedPts.length; i++) {
          shape.lineTo(roundedPts[i].x, roundedPts[i].y);
        }
        shape.closePath();
      }

      const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness,
        bevelSize,
        bevelSegments: 3,
        curveSegments: 1,
      });
      extrudeGeo.translate(0, 0, -(depth + bevelThickness));

      piece.glassMesh.geometry.dispose();
      piece.glassMesh.geometry = extrudeGeo;

      const printGeo = new THREE.ShapeGeometry(shape, 1);
      const posAttr = printGeo.attributes.position;
      const uvAttr = printGeo.attributes.uv;

      const panelLeftX = -layout.panelWidth * 0.5;
      const panelTopY = layout.blockHeight * 0.5 - layout.navHeight - layout.gapPx;
      const navLeftX = -layout.blockWidth * 0.5;
      const navBottomY = layout.blockHeight * 0.5 - layout.navHeight;

      for (let i = 0; i < posAttr.count; i++) {
        const lx = posAttr.getX(i);
        const ly = posAttr.getY(i);
        const bx = center.x + lx;
        const by = center.y + ly;

        if (isNav) {
          const u = (bx - navLeftX) / layout.blockWidth;
          const v = (by - navBottomY) / layout.navHeight;
          uvAttr.setXY(i, u, v);
        } else {
          const u = (bx - panelLeftX) / layout.panelWidth;
          const v = 1.0 - (panelTopY - by) / layout.panelHeight;
          uvAttr.setXY(i, u, v);
        }
      }
      uvAttr.needsUpdate = true;

      piece.printMesh.geometry.dispose();
      piece.printMesh.geometry = printGeo;
    }

    function rebuildNavGeometry() {
      const halfW = layout.blockWidth * 0.5;
      const topY = layout.blockHeight * 0.5;
      const botY = topY - layout.navHeight;

      const navCornersCCW: Point2D[] = [
        { x: -halfW, y: botY },
        { x: halfW, y: botY },
        { x: halfW, y: topY },
        { x: -halfW, y: topY },
      ];
      buildPieceGeometry(pieces.nav, navCornersCCW, true);
    }

    function rebuildCutCellsGeometry(
      timeSec: number,
      pointerPanelNorm: Point2D | null,
      pointerInfluence: number
    ) {
      const cells = getCutCells(timeSec, pointerPanelNorm, pointerInfluence, layout.isPortrait);
      const panelLeftX = -layout.panelWidth * 0.5;
      const panelTopY = layout.blockHeight * 0.5 - layout.navHeight - layout.gapPx;

      for (const cell of cells) {
        const blockPts: Point2D[] = cell.normVertices.map((pt) => ({
          x: panelLeftX + pt.x * layout.panelWidth,
          y: panelTopY - pt.y * layout.panelHeight,
        }));
        buildPieceGeometry(pieces[cell.id], blockPts, false);
      }
    }

    function rebuildBackSliverGeometry() {
      const { localVertices, centerWorld } = getBackSliverPolygon(W, H);
      const k = layout.kSliver;
      const depth = 11 * k;
      const bevel = 2.4 * k;
      const radius = 14 * k;

      const roundedPts = buildRoundedPolygonPoints(localVertices, radius, 7);
      const shape = new THREE.Shape();
      if (roundedPts.length > 0) {
        shape.moveTo(roundedPts[0].x, roundedPts[0].y);
        for (let i = 1; i < roundedPts.length; i++) {
          shape.lineTo(roundedPts[i].x, roundedPts[i].y);
        }
        shape.closePath();
      }

      const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 3,
        curveSegments: 1,
      });
      extrudeGeo.translate(0, 0, -(depth + bevel));

      backSliverMesh.geometry.dispose();
      backSliverMesh.geometry = extrudeGeo;

      const labelW = Math.max(110, Math.round(150 * k));
      const labelH = Math.max(54, Math.round(75 * k));
      const planeGeo = new THREE.PlaneGeometry(labelW, labelH);
      backSliverPrintMesh.geometry.dispose();
      backSliverPrintMesh.geometry = planeGeo;

      backSliverGroup.position.set(centerWorld.x, centerWorld.y, 0);
    }

    rebuildNavGeometry();
    rebuildCutCellsGeometry(0, null, 0);
    rebuildBackSliverGeometry();

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    const isRecParam = params.get('rec') === '1';

    if (viewParam === 'paper') {
      portalModeRef.current = 'rules';
      setPortalMode('rules');
      phaseRef.current = 'paper';
      setPhaseState('paper');
      setDefinitionsOpacity(1);
    } else if (
      isRecParam ||
      viewParam === 'city' ||
      viewParam === 'norva' ||
      viewParam === 'controller'
    ) {
      portalModeRef.current = 'controller';
      setPortalMode('controller');
      phaseRef.current = 'paper';
      setPhaseState('paper');
      setDefinitionsOpacity(1);
    } else if (viewParam === 'camera') {
      portalModeRef.current = 'camera';
      setPortalMode('camera');
      phaseRef.current = 'paper';
      setPhaseState('paper');
      setDefinitionsOpacity(1);
    } else if (params.get('autostart') === '1') {
      phaseRef.current = 'hero';
      setPhaseState('hero');
    } else {
      phaseRef.current = 'entering';
      phaseStartTimeRef.current = performance.now() * 0.001;
      setPhaseState('entering');
    }

    let paperFrameRendered = false;

    triggerShatterRef.current = (mode: ActivePortalMode) => {
      portalModeRef.current = mode;
      setPortalMode(mode);
      paperFrameRendered = false;
      if (phaseRef.current === 'shattering' || phaseRef.current === 'paper') return;
      phaseRef.current = 'shattering';
      phaseStartTimeRef.current = performance.now() * 0.001;
      setPhaseState('shattering');
      updateHoverFlag({
        openStudioHovered: false,
        controllerHovered: false,
        readPaperHovered: false,
        hoveredNavLink: null,
      });
    };

    triggerReassembleRef.current = () => {
      paperFrameRendered = false;
      if (phaseRef.current === 'reassembling' || phaseRef.current === 'hero') return;
      phaseRef.current = 'reassembling';
      phaseStartTimeRef.current = performance.now() * 0.001;
      setPhaseState('reassembling');
      updateHoverFlag({ backHovered: false });
    };

    let pointerInside = false;
    let pointerNormX = 0;
    let pointerNormY = 0;
    let pointerPanelNorm: Point2D = { x: 0.35, y: 0.5 };
    let pointerInfluence = 0;
    let hoveredPieceId: PieceId | null = null;
    let isBackSliverHovered3D = false;

    const DEG2RAD = Math.PI / 180;
    let currentBlockRotX = 0.8 * DEG2RAD;
    let currentBlockRotY = -1.2 * DEG2RAD;

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const scratchVec3 = new THREE.Vector3();
    const scratchQuat = new THREE.Quaternion();
    const scratchAxis = new THREE.Vector3();

    const onPointerMove = (e: PointerEvent) => {
      pointerInside = true;
      pointerNormX = e.clientX / W - 0.5;
      pointerNormY = e.clientY / H - 0.5;

      const worldX = e.clientX - W * 0.5;
      const worldY = H * 0.5 - e.clientY;
      cursorGlowUniforms.uPointerWorld.value.set(worldX, worldY, 0);

      const panelLeftPx = layout.marginX;
      const panelTopPx = layout.marginY + layout.navHeight + layout.gapPx;
      pointerPanelNorm = {
        x: (e.clientX - panelLeftPx) / layout.panelWidth,
        y: (e.clientY - panelTopPx) / layout.panelHeight,
      };

      if (phaseRef.current === 'hero' || phaseRef.current === 'entering') {
        pointerNdc.set((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1);
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(interactableMeshes, false);
        hoveredPieceId = hits.length > 0 ? (hits[0].object.userData.pieceId as PieceId) : null;
      } else {
        hoveredPieceId = null;
      }

      if (
        (phaseRef.current === 'paper' || phaseRef.current === 'shattering') &&
        portalModeRef.current === 'rules'
      ) {
        pointerNdc.set((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1);
        raycaster.setFromCamera(pointerNdc, camera);
        const backHits = raycaster.intersectObject(backSliverMesh, false);
        const nowBackHov = backHits.length > 0 || hoverStateRef.current.backHovered;
        if (nowBackHov !== isBackSliverHovered3D) {
          isBackSliverHovered3D = nowBackHov;
          drawBackSliverCanvas(backCanvas, W, isBackSliverHovered3D);
          backTexture.needsUpdate = true;
        }
      }
    };

    const onPointerLeave = () => {
      pointerInside = false;
      hoveredPieceId = null;
    };

    const onCanvasClick = (e: MouseEvent) => {
      if (phaseRef.current === 'paper' && portalModeRef.current === 'rules') {
        pointerNdc.set((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1);
        raycaster.setFromCamera(pointerNdc, camera);
        const backHits = raycaster.intersectObject(backSliverMesh, false);
        if (backHits.length > 0) {
          triggerReassembleRef.current();
        }
      }
    };

    const onResize = () => {
      W = window.innerWidth || 1440;
      H = window.innerHeight || 960;
      layout = computeBlockLayout(W, H);
      setViewport({ w: W, h: H });

      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.position.set(0, 0, layout.cameraZ);
      camera.updateProjectionMatrix();

      cursorGlowUniforms.uScaleS.value = layout.S;
      shatterTrajectories = createShatterTrajectories(layout.S);

      keyLight.position.set(-W * 0.65, H * 0.78, 950);
      rimLight.position.set(W * 0.55, -H * 0.55, 650);

      panelTexture.dispose();
      navTexture.dispose();
      backTexture.dispose();
      drawPanelCanvas(panelCanvas, layout, hoverStateRef.current, canvasDpr);
      drawNavCanvas(navCanvas, layout, hoverStateRef.current, canvasDpr);
      drawBackSliverCanvas(backCanvas, W, hoverStateRef.current.backHovered);
      panelTexture.needsUpdate = true;
      navTexture.needsUpdate = true;
      backTexture.needsUpdate = true;
      canvasDirtyRef.current = false;

      rebuildNavGeometry();
      rebuildCutCellsGeometry(performance.now() * 0.001, pointerPanelNorm, pointerInfluence);
      rebuildBackSliverGeometry();
      paperFrameRendered = false;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    renderer.domElement.addEventListener('click', onCanvasClick);
    window.addEventListener('resize', onResize);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        canvasDirtyRef.current = true;
        paperFrameRendered = false;
        drawBackSliverCanvas(backCanvas, W, hoverStateRef.current.backHovered);
        backTexture.needsUpdate = true;
      });
    }

    let frameId = 0;
    let disposed = false;
    let lastTimeSec = performance.now() * 0.001;
    let lastGeoRebuildSec = -1;
    let lastBackHoverDrawn = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;

      // Once the 6 3D shards have parked at the screen border in Camera/Controller mode,
      // sleep the WebGL render loop (0% GPU / 0% CPU!) while CSS compositor floats the canvas layer.
      if (
        phaseRef.current === 'paper' &&
        portalModeRef.current !== 'rules' &&
        paperFrameRendered &&
        !canvasDirtyRef.current
      ) {
        frameId = window.setTimeout(tick, 150);
        return;
      }

      const nowSec = performance.now() * 0.001;
      const dt = Math.min(0.12, Math.max(0.001, nowSec - lastTimeSec));
      lastTimeSec = nowSec;

      if (canvasDirtyRef.current) {
        canvasDirtyRef.current = false;
        drawPanelCanvas(panelCanvas, layout, hoverStateRef.current, canvasDpr);
        drawNavCanvas(navCanvas, layout, hoverStateRef.current, canvasDpr);
        panelTexture.needsUpdate = true;
        navTexture.needsUpdate = true;
      }

      const effectiveBackHover = hoverStateRef.current.backHovered || isBackSliverHovered3D;
      if (effectiveBackHover !== lastBackHoverDrawn) {
        lastBackHoverDrawn = effectiveBackHover;
        drawBackSliverCanvas(backCanvas, W, effectiveBackHover);
        backTexture.needsUpdate = true;
      }

      const phase = phaseRef.current;
      const phaseElapsed = nowSec - phaseStartTimeRef.current;

      const targetInfluence = pointerInside
        ? 1.0
        : phase === 'paper' || phase === 'shattering'
        ? 0.75
        : 0.0;
      const infAlpha = 1 - Math.exp(-dt / 0.18);
      pointerInfluence += (targetInfluence - pointerInfluence) * infAlpha;
      cursorGlowUniforms.uPointerGlow.value = pointerInfluence;

      if (!pointerInside && (phase === 'paper' || phase === 'shattering')) {
        cursorGlowUniforms.uPointerWorld.value.set(
          Math.cos(nowSec * 0.85) * W * 0.42,
          Math.sin(nowSec * 0.65) * H * 0.38,
          0
        );
      }

      const ambientOrbitX = phase === 'paper' ? Math.sin(nowSec * 0.75) * 0.42 : 0;
      const ambientOrbitY = phase === 'paper' ? Math.cos(nowSec * 0.6) * 0.35 : 0;
      const tiltXInput =
        (pointerInside && phase === 'hero' ? pointerNormX * 2 : 0) + ambientOrbitX;
      const tiltYInput =
        (pointerInside && phase === 'hero' ? pointerNormY * 2 : 0) + ambientOrbitY;
      const targetBlockRotY = (tiltXInput * 7.0 - 1.2) * DEG2RAD;
      const targetBlockRotX = (-tiltYInput * 5.5 + 0.8) * DEG2RAD;
      const tiltAlpha = 1 - Math.exp(-dt / 0.3);

      currentBlockRotX += (targetBlockRotX - currentBlockRotX) * tiltAlpha;
      currentBlockRotY += (targetBlockRotY - currentBlockRotY) * tiltAlpha;
      blockGroup.rotation.set(currentBlockRotX, currentBlockRotY, 0);
      blockGroup.updateMatrixWorld(true);

      if (phase === 'hero' && nowSec - lastGeoRebuildSec >= 1 / 45) {
        lastGeoRebuildSec = nowSec;
        rebuildCutCellsGeometry(nowSec, pointerPanelNorm, pointerInfluence);
      }

      const baseIridescence = 0.55;
      let maxShatterU = 0;

      for (let pieceIdx = 0; pieceIdx < pieceIds.length; pieceIdx++) {
        const id = pieceIds[pieceIdx];
        const piece = pieces[id];
        const isHovered = phase === 'hero' && hoveredPieceId === id;

        const targetLift = isHovered ? (id === 'nav' ? 32 * layout.S : 50 * layout.S) : 0;
        let targetTipX = 0;
        let targetTipY = 0;
        if (isHovered) {
          const tip = computeHoverTip(
            {
              x: cursorGlowUniforms.uPointerWorld.value.x,
              y: cursorGlowUniforms.uPointerWorld.value.y,
            },
            piece.restCenter,
            piece.approxRadius,
            0.24
          );
          targetTipX = tip.rotX;
          targetTipY = tip.rotY;
        }

        piece.liftSpring = stepSpring(piece.liftSpring, targetLift, dt, 170, 19);
        piece.rotXSpring = stepSpring(piece.rotXSpring, targetTipX, dt, 170, 19);
        piece.rotYSpring = stepSpring(piece.rotYSpring, targetTipY, dt, 170, 19);
        piece.sheenSpring = stepSpring(piece.sheenSpring, isHovered ? 1 : 0, dt, 170, 19);

        const traj = shatterTrajectories[id];
        let shatterU = 0;

        if (phase === 'entering') {
          const localT = (phaseElapsed - traj.staggerSec) / 0.72;
          if (localT <= 0) {
            shatterU = 1;
          } else if (localT >= 1) {
            shatterU = 0;
          } else {
            shatterU = 1 - easeOutBack(localT, 1.15);
          }
        } else if (phase === 'shattering') {
          const localT = (phaseElapsed - traj.staggerSec) / 0.76;
          if (localT <= 0) {
            shatterU = 0;
          } else if (localT >= 1) {
            shatterU = 1;
          } else {
            // Smooth C1 ease-in-out curve so shards accelerate from the fracture and glide smoothly into the screen border with 0 velocity jump
            shatterU =
              localT < 0.42
                ? 1.9841 * localT * localT
                : 1 - Math.pow(1 - localT, 3) * 3.3069;
          }
        } else if (phase === 'paper') {
          shatterU = 1;
        } else if (phase === 'reassembling') {
          const localT = (phaseElapsed - traj.staggerSec) / 0.72;
          if (localT <= 0) {
            shatterU = 1;
          } else if (localT >= 1) {
            shatterU = 0;
          } else {
            shatterU = 1 - easeOutBack(localT, 1.15);
          }
        }

        if (shatterU > maxShatterU) maxShatterU = shatterU;

        const sheen = Math.max(0, Math.min(1, piece.sheenSpring.value));
        const borderGlassBoost = Math.max(0, shatterU) * 0.44;
        piece.glassMesh.material.iridescence = Math.min(
          1.0,
          baseIridescence + (1.0 - baseIridescence) * sheen + borderGlassBoost
        );
        piece.glassMesh.material.envMapIntensity =
          1.0 + 0.9 * sheen + Math.max(0, shatterU) * 0.75;

        const pose = evaluateShatterPose(traj, shatterU);

        // Smoothly ramp in the zero-gravity 3D breathing & drift so derivative at u=1 is continuous
        const clampedU = Math.max(0, Math.min(1, shatterU));
        const floatWeight = clampedU * clampedU * (3 - 2 * clampedU);
        const floatPhase = nowSec * 1.35 + pieceIdx * 1.25;
        const floatX = Math.sin(floatPhase) * 32 * layout.S * floatWeight;
        const floatY = Math.cos(floatPhase * 0.9) * 26 * layout.S * floatWeight;
        const floatZ = Math.sin(floatPhase * 0.75) * 36 * layout.S * floatWeight;
        const floatAngle =
          pose.angle + Math.sin(nowSec * 1.2 + pieceIdx * 1.4) * 0.28 * floatWeight;

        piece.group.position.set(
          piece.restCenter.x + pose.dx + floatX,
          piece.restCenter.y + pose.dy + floatY,
          piece.liftSpring.value + pose.dz + floatZ
        );

        piece.group.rotation.set(piece.rotXSpring.value, piece.rotYSpring.value, 0);
        if (Math.abs(floatAngle) > 1e-4) {
          scratchAxis.set(pose.axis[0], pose.axis[1], pose.axis[2]);
          scratchQuat.setFromAxisAngle(scratchAxis, floatAngle);
          piece.group.quaternion.multiply(scratchQuat);
        }

        piece.group.visible = true;
      }

      panelPrintMaterial.opacity = Math.max(0.14, 1 - maxShatterU * 0.86);
      navPrintMaterial.opacity = Math.max(0.14, 1 - maxShatterU * 0.86);

      const maxStagger = 0.15;
      const totalFlightDuration = 0.76 + maxStagger;
      const showSliver = portalModeRef.current === 'rules';

      if (phase === 'entering' && phaseElapsed >= totalFlightDuration) {
        phaseRef.current = 'hero';
        setPhaseState('hero');
      } else if (phase === 'shattering') {
        const defAlpha = Math.max(0, Math.min(1, (phaseElapsed - 0.18) / 0.52));
        if (workspaceWrapRef.current) {
          workspaceWrapRef.current.style.opacity = String(defAlpha);
          workspaceWrapRef.current.style.pointerEvents = defAlpha > 0.6 ? 'auto' : 'none';
        }

        const sliverT = Math.max(0, Math.min(1, (phaseElapsed - 0.3) / 0.38));
        const sliverScale = sliverT > 0 ? Math.max(0, easeOutBack(sliverT, 1.1)) : 0;
        backSliverGroup.visible = showSliver && sliverScale > 0.01;
        backSliverGroup.scale.setScalar(Math.max(0.001, sliverScale));

        if (phaseElapsed >= totalFlightDuration) {
          phaseRef.current = 'paper';
          setPhaseState('paper');
          setDefinitionsOpacity(1);
          if (workspaceWrapRef.current) {
            workspaceWrapRef.current.style.opacity = '1';
            workspaceWrapRef.current.style.pointerEvents = 'auto';
          }
        }
      } else if (phase === 'paper') {
        backSliverGroup.visible = showSliver;
        backSliverGroup.scale.setScalar(1);
        if (workspaceWrapRef.current) {
          workspaceWrapRef.current.style.opacity = '1';
          workspaceWrapRef.current.style.pointerEvents = 'auto';
        }
      } else if (phase === 'reassembling') {
        const defAlpha = Math.max(0, 1 - phaseElapsed / 0.25);
        if (workspaceWrapRef.current) {
          workspaceWrapRef.current.style.opacity = String(defAlpha);
          workspaceWrapRef.current.style.pointerEvents = 'none';
        }

        const sliverScale = Math.max(0, 1 - easeInCubic(Math.min(1, phaseElapsed / 0.25)));
        backSliverGroup.visible = showSliver && sliverScale > 0.01;
        backSliverGroup.scale.setScalar(Math.max(0.001, sliverScale));

        if (phaseElapsed >= totalFlightDuration) {
          phaseRef.current = 'hero';
          setPhaseState('hero');
          setDefinitionsOpacity(0);
          backSliverGroup.visible = false;
        }
      } else {
        backSliverGroup.visible = false;
      }

      if (backSliverGroup.visible) {
        const wobbleX = Math.sin(nowSec * Math.PI * 2 * 0.95) * 0.034;
        const wobbleY = Math.cos(nowSec * Math.PI * 2 * 1.08) * 0.036;

        let hoverTipX = 0;
        let hoverTipY = 0;
        if (effectiveBackHover && pointerInside) {
          const sliverCenter = backSliverGroup.position;
          const dx = Math.max(
            -1,
            Math.min(
              1,
              (cursorGlowUniforms.uPointerWorld.value.x - sliverCenter.x) / (120 * layout.kSliver)
            )
          );
          const dy = Math.max(
            -1,
            Math.min(
              1,
              (cursorGlowUniforms.uPointerWorld.value.y - sliverCenter.y) / (70 * layout.kSliver)
            )
          );
          hoverTipY = dx * 0.14;
          hoverTipX = -dy * 0.14;
        }

        backSliverGroup.rotation.set(
          0.08 + wobbleX + hoverTipX,
          -0.16 + wobbleY + hoverTipY,
          0
        );
      }

      if (domOverlayRef.current && (phase === 'hero' || phase === 'entering')) {
        const halfW = layout.blockWidth * 0.5;
        const halfH = layout.blockHeight * 0.5;

        const corners3D: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
          new THREE.Vector3(-halfW, halfH, 0),
          new THREE.Vector3(halfW, halfH, 0),
          new THREE.Vector3(halfW, -halfH, 0),
          new THREE.Vector3(-halfW, -halfH, 0),
        ];

        const dstCorners = corners3D.map((c) => {
          scratchVec3.copy(c).applyMatrix4(blockGroup.matrixWorld).project(camera);
          return {
            x: (scratchVec3.x * 0.5 + 0.5) * W,
            y: (-scratchVec3.y * 0.5 + 0.5) * H,
          };
        }) as [Point2D, Point2D, Point2D, Point2D];

        const srcCorners: [Point2D, Point2D, Point2D, Point2D] = [
          { x: 0, y: 0 },
          { x: layout.blockWidth, y: 0 },
          { x: layout.blockWidth, y: layout.blockHeight },
          { x: 0, y: layout.blockHeight },
        ];

        domOverlayRef.current.style.transform = computeHomographyMatrix3d(srcCorners, dstCorners);
      }

      renderer.render(scene, camera);

      if (phase === 'paper' && portalModeRef.current !== 'rules') {
        paperFrameRendered = true;
      } else {
        paperFrameRendered = false;
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('click', onCanvasClick);
      window.removeEventListener('resize', onResize);

      for (const id of pieceIds) {
        pieces[id].glassMesh.geometry.dispose();
        pieces[id].glassMesh.material.dispose();
        pieces[id].printMesh.geometry.dispose();
      }
      backSliverMesh.geometry.dispose();
      backSliverGlassMat.dispose();
      backSliverPrintMesh.geometry.dispose();

      panelTexture.dispose();
      navTexture.dispose();
      backTexture.dispose();
      panelPrintMaterial.dispose();
      navPrintMaterial.dispose();
      backPrintMaterial.dispose();
      envTexture.dispose();
      renderer.dispose();
    };
  }, [fallbackMode, updateHoverFlag]);

  if (fallbackMode) {
    return <StaticFallback />;
  }

  const layout = computeBlockLayout(viewport.w, viewport.h);
  const metrics = computePanelMetrics(layout);
  const heroDomActive = phaseState === 'hero' || phaseState === 'entering';
  const postShatterVisible =
    phaseState === 'shattering' || phaseState === 'paper' || phaseState === 'reassembling';

  const panelTopOffset = layout.navHeight + layout.gapPx;
  const activePreset = SYSTEM_PRESETS[presetIndex];

  return (
    <div
      className="relative w-screen h-screen bg-[#050507] overflow-hidden"
      data-state={phaseState}
    >
      {/* Dedicated WebGL Canvas Mount (floated by zero-cost GPU compositor in paper phase) */}
      <div
        ref={canvasMountRef}
        className={`fixed inset-0 z-0 ${
          phaseState === 'paper' && portalMode !== 'rules' ? 'tej-border-breathe' : ''
        }`}
      />

      {/* Transparent Homography-Mapped Selectable DOM Text & Hit Layer */}
      <div
        ref={domOverlayRef}
        aria-hidden={!heroDomActive}
        data-testid="homography-dom-layer"
        className="homography-text-layer fixed top-0 left-0 z-10 origin-top-left"
        style={{
          width: `${layout.blockWidth}px`,
          height: `${layout.blockHeight}px`,
          pointerEvents: heroDomActive ? 'auto' : 'none',
          visibility: heroDomActive ? 'visible' : 'hidden',
        }}
      >
        {/* Nav Slab Hit & Text Layer */}
        <header
          className="absolute top-0 left-0 w-full flex items-center justify-between"
          style={{
            height: `${layout.navHeight}px`,
            paddingLeft: `${metrics.navPadX}px`,
            paddingRight: `${metrics.navPadX}px`,
          }}
        >
          <a
            href="#tejprakash"
            onClick={(e) => {
              e.preventDefault();
              handleControllerClick();
            }}
            className="font-semibold text-transparent whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded px-1"
            style={{ fontSize: `${Math.max(12.5, 15 * Math.max(0.58, layout.S))}px` }}
          >
            The Tejprakash
          </a>

          {!layout.isPhone && (
            <nav
              aria-label="Primary navigation"
              className="flex items-center gap-6"
              style={{ fontSize: `${metrics.navFontPx}px` }}
            >
              <button
                type="button"
                onClick={handleCameraClick}
                onMouseEnter={() => updateHoverFlag({ hoveredNavLink: 'studio' })}
                onMouseLeave={() => updateHoverFlag({ hoveredNavLink: null })}
                className="text-transparent cursor-pointer bg-transparent border-0 p-1 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded"
              >
                Camera
              </button>
              <button
                type="button"
                onClick={handleControllerClick}
                onMouseEnter={() => updateHoverFlag({ hoveredNavLink: 'materials' })}
                onMouseLeave={() => updateHoverFlag({ hoveredNavLink: null })}
                className="text-transparent cursor-pointer bg-transparent border-0 p-1 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded"
              >
                Controller
              </button>
            </nav>
          )}

          <button
            type="button"
            onClick={handleControllerClick}
            onMouseEnter={() => updateHoverFlag({ hoveredNavLink: 'signin' })}
            onMouseLeave={() => updateHoverFlag({ hoveredNavLink: null })}
            className="text-transparent font-medium cursor-pointer bg-transparent border-0 p-1 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded"
            style={{ fontSize: `${metrics.navFontPx}px` }}
          >
            Manual / AI
          </button>
        </header>

        {/* Main Panel Selectable Text & Interactive Controls */}
        <main
          className="absolute left-0 w-full"
          style={{
            top: `${panelTopOffset}px`,
            height: `${layout.panelHeight}px`,
          }}
        >
          {/* Eyebrow */}
          <p
            className="absolute m-0 text-transparent font-medium uppercase whitespace-nowrap"
            style={{
              left: `${metrics.padX}px`,
              top: `${metrics.eyebrowY - metrics.eyebrowFontPx}px`,
              fontSize: `${metrics.eyebrowFontPx}px`,
              letterSpacing: '0.2em',
            }}
          >
            THE TEJPRAKASH · ENERGY CONSERVATION
          </p>

          {/* Headline */}
          <h1
            className="absolute m-0 text-transparent font-medium"
            style={{
              left: `${metrics.padX}px`,
              top: `${metrics.headlineY}px`,
              fontSize: `${metrics.headlineFontPx}px`,
              lineHeight: 0.97,
              letterSpacing: '-0.045em',
            }}
          >
            Smart class,
            <br />
            zero waste.
          </h1>

          {/* Two-line Vision Thought */}
          <p
            className="absolute m-0 text-transparent"
            style={{
              left: `${metrics.padX}px`,
              top: `${metrics.subY}px`,
              fontSize: `${metrics.subFontPx}px`,
              lineHeight: 1.52,
            }}
          >
            Power should follow presence, never carelessness.
            <br />
            Every empty classroom saved today lights a greener tomorrow.
          </p>

          {/* "Camera" light pill button */}
          <button
            type="button"
            data-testid="btn-camera"
            onClick={handleCameraClick}
            onMouseEnter={() => updateHoverFlag({ openStudioHovered: true })}
            onMouseLeave={() => updateHoverFlag({ openStudioHovered: false })}
            onFocus={() => updateHoverFlag({ openStudioHovered: true })}
            onBlur={() => updateHoverFlag({ openStudioHovered: false })}
            className="absolute text-transparent font-medium cursor-pointer bg-transparent border-0 flex items-center justify-center whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#36d67e]"
            style={{
              left: `${metrics.padX}px`,
              top: `${metrics.ctaY}px`,
              width: `${metrics.pillW}px`,
              height: `${metrics.pillH}px`,
              borderRadius: `${metrics.pillRadius}px`,
              fontSize: `${metrics.pillFontPx}px`,
            }}
          >
            Camera
          </button>

          {/* "Controller" pill button */}
          <button
            type="button"
            data-testid="btn-controller"
            onClick={handleControllerClick}
            onMouseEnter={() => updateHoverFlag({ controllerHovered: true })}
            onMouseLeave={() => updateHoverFlag({ controllerHovered: false })}
            onFocus={() => updateHoverFlag({ controllerHovered: true })}
            onBlur={() => updateHoverFlag({ controllerHovered: false })}
            className="absolute text-transparent font-medium cursor-pointer bg-transparent border-0 flex items-center justify-center whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#36d67e]"
            style={{
              left: `${metrics.controllerPillX}px`,
              top: `${metrics.ctaY}px`,
              width: `${metrics.controllerPillW}px`,
              height: `${metrics.pillH}px`,
              borderRadius: `${metrics.pillRadius}px`,
              fontSize: `${metrics.pillFontPx}px`,
            }}
          >
            Controller
          </button>

          {/* Bottom-left & Bottom-right captions */}
          <span
            className="absolute text-transparent whitespace-nowrap"
            style={{
              left: `${metrics.padX}px`,
              top: `${metrics.footerY - metrics.footerFontPx}px`,
              fontSize: `${metrics.footerFontPx}px`,
            }}
          >
            © The Tejprakash · B.Tech AIML Project
          </span>

          <span
            className="absolute text-transparent whitespace-nowrap text-right"
            style={{
              right: `${metrics.padX}px`,
              top: `${metrics.footerY - metrics.footerFontPx}px`,
              fontSize: `${metrics.footerFontPx}px`,
            }}
          >
            {`Arduino UNO · L298N · ${activePreset.name}`}
          </span>
        </main>
      </div>

      {/* Admin Controller Password Prompt Modal (Smoked-Glass Slab, No Password Hint) */}
      {passwordModalOpen && (
        <div
          data-testid="controller-password-modal"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
        >
          <div className="relative w-full max-w-md rounded-[20px] bg-[#16161b]/92 backdrop-blur-2xl border border-white/[0.12] p-7 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.20),inset_1px_0_0_0_rgba(255,255,255,0.08),0_28px_70px_rgba(0,0,0,0.85)]">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#b9aee8]/45 to-transparent" />

            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium tracking-[0.2em] uppercase text-white/40">
                THE TEJPRAKASH · RESTRICTED ACCESS
              </span>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                className="text-white/50 hover:text-white text-xs cursor-pointer bg-transparent border-0"
              >
                ✕ Close
              </button>
            </div>

            <h2 className="text-xl font-medium tracking-[-0.03em] text-white/95 mb-1.5">
              Controller Authorization
            </h2>
            <p className="text-xs text-white/55 leading-relaxed mb-5">
              Enter the administrator password to unlock Manual &amp; AI Model Dual-Fan Control.
            </p>

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="controller-password-input"
                  className="block text-[11px] font-medium text-white/60 mb-1.5"
                >
                  Administrator Password
                </label>
                <input
                  id="controller-password-input"
                  data-testid="controller-password-input"
                  type="password"
                  autoFocus
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setPasswordError(null);
                  }}
                  placeholder="Enter controller password"
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-[#08080b] border border-white/[0.15] text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#36d67e]"
                />
                {passwordError && (
                  <p className="text-[11px] text-rose-400 mt-1.5 m-0">{passwordError}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(false)}
                  className="px-4 py-2.5 rounded-[7px] bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.14] text-xs font-medium text-white/80 cursor-pointer transition-all"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  data-testid="controller-password-submit"
                  className="px-6 py-2.5 rounded-[7px] bg-[#ededf0] hover:bg-[#36d67e] text-[#09090c] font-medium text-xs cursor-pointer transition-all"
                >
                  Unlock Controller →
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shatter Reveal 1: Smoked-Glass Tejprakash Workspace (for Camera & Controller Modes) */}
      <div
        ref={workspaceWrapRef}
        style={{
          opacity: phaseState === 'paper' ? 1 : 0,
          pointerEvents: phaseState === 'paper' ? 'auto' : 'none',
          willChange: 'opacity',
        }}
      >
        <TejprakashWorkspace
          visible={
            postShatterVisible && (portalMode === 'camera' || portalMode === 'controller')
          }
          initialRole={portalMode === 'camera' ? 'camera' : 'controller'}
          onBackToHero={handleBackClick}
          onRequestControllerLogin={() => {
            setPasswordError(null);
            setPasswordModalOpen(true);
          }}
          fan1Speed={fan1Speed}
          fan2Speed={fan2Speed}
          onFanSpeedChange={handleFanSpeedChange}
        />
      </div>

      {/* Shatter Reveal 2: Five System Rules of The Tejprakash (when clicking "System rules →") */}
      <DefinitionsView
        opacity={definitionsOpacity}
        visible={postShatterVisible && portalMode === 'rules'}
        backHovered={backHovered}
        onBackHoverChange={(hovered) => updateHoverFlag({ backHovered: hovered })}
        onBackClick={handleBackClick}
        viewportW={viewport.w}
        viewportH={viewport.h}
      />
    </div>
  );
}
