import * as THREE from 'three';

export interface Vec3Point {
  x: number;
  y: number;
  z: number;
}

export interface CircuitTraceDef {
  id: string;
  waypoints: Vec3Point[];
  totalLength: number;
  segmentLengths: number[];
  speed: number;
  phaseOffset: number;
  isMotorTrace?: 'fan1' | 'fan2';
}

/**
 * Computes segment lengths and total arc length for a 3D PCB trace path.
 */
export function buildCircuitTraceDef(
  id: string,
  waypoints: Vec3Point[],
  speed = 0.22,
  phaseOffset = 0,
  isMotorTrace?: 'fan1' | 'fan2'
): CircuitTraceDef {
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    segmentLengths.push(len);
    totalLength += len;
  }
  return {
    id,
    waypoints,
    totalLength: Math.max(1e-5, totalLength),
    segmentLengths,
    speed,
    phaseOffset,
    isMotorTrace,
  };
}

/**
 * Samples a 3D point along a multi-segment PCB circuit trace at normalized loop progress t in [0, 1).
 */
export function sampleCircuitTrace(trace: CircuitTraceDef, t: number): Vec3Point {
  const { waypoints, segmentLengths, totalLength } = trace;
  if (waypoints.length === 0) return { x: 0, y: 0, z: 0 };
  if (waypoints.length === 1) return { ...waypoints[0] };

  const wrappedT = ((t % 1) + 1) % 1;
  const targetDist = wrappedT * totalLength;

  let accum = 0;
  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i];
    if (accum + segLen >= targetDist || i === segmentLengths.length - 1) {
      const localU = segLen > 1e-6 ? (targetDist - accum) / segLen : 0;
      const a = waypoints[i];
      const b = waypoints[i + 1];
      return {
        x: a.x + (b.x - a.x) * localU,
        y: a.y + (b.y - a.y) * localU,
        z: a.z + (b.z - a.z) * localU,
      };
    }
    accum += segLen;
  }

  const last = waypoints[waypoints.length - 1];
  return { ...last };
}

export interface CircuitCityController {
  rootGroup: THREE.Group;
  update: (
    timeSec: number,
    dt: number,
    opacity: number,
    pointerNormX: number,
    pointerNormY: number,
    fan1SpeedPct: number,
    fan2SpeedPct: number
  ) => void;
  dispose: () => void;
}

/**
 * Builds the 3D "Processor & Register City" (Silicon Motherboard Metropolis)
 * with glowing blue PCB current paths and looping moving blue current points.
 */
export function createCircuitCityScene(scaleFactor = 1): CircuitCityController {
  const rootGroup = new THREE.Group();
  rootGroup.visible = false;

  const S = Math.max(0.65, scaleFactor);
  const cityGroup = new THREE.Group();
  // Isometric 3D city skyline tilt (-0.56 rad ~ 32 deg) so processor & register towers rise dramatically
  cityGroup.rotation.x = -0.56;
  cityGroup.position.set(-60 * S, -75 * S, -40 * S);
  rootGroup.add(cityGroup);

  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];
  const texturesToDispose: THREE.Texture[] = [];

  // 1. Dark Silicon Substrate / Motherboard Ground Plane
  const boardGeo = new THREE.PlaneGeometry(2400 * S, 1800 * S, 48, 36);
  boardGeo.rotateX(-Math.PI * 0.5);
  geometriesToDispose.push(boardGeo);

  const boardMat = new THREE.MeshStandardMaterial({
    color: 0x050914,
    roughness: 0.45,
    metalness: 0.35,
    transparent: true,
    opacity: 1,
  });
  materialsToDispose.push(boardMat);
  const boardMesh = new THREE.Mesh(boardGeo, boardMat);
  boardMesh.position.y = -2 * S;
  cityGroup.add(boardMesh);

  // Subtle dark-blue wafer city grid on the substrate
  const gridHelper = new THREE.GridHelper(2200 * S, 44, 0x0ea5e9, 0x0b2239);
  gridHelper.position.y = 0.2 * S;
  const gridMat = gridHelper.material as THREE.Material;
  gridMat.transparent = true;
  (gridMat as THREE.LineBasicMaterial).opacity = 0.32;
  materialsToDispose.push(gridMat);
  cityGroup.add(gridHelper);

  // Shared materials for Processor Core, Register Skyscrapers, IC Pins, and Rooftop Neon Edges
  const chipBodyMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1324,
    roughness: 0.28,
    metalness: 0.65,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
    transparent: true,
    opacity: 1,
  });
  materialsToDispose.push(chipBodyMat);

  const cpuCapMat = new THREE.MeshPhysicalMaterial({
    color: 0x112240,
    roughness: 0.2,
    metalness: 0.8,
    clearcoat: 0.9,
    emissive: new THREE.Color(0x0284c7),
    emissiveIntensity: 0.22,
    transparent: true,
    opacity: 1,
  });
  materialsToDispose.push(cpuCapMat);

  const edgeWireMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.55,
  });
  materialsToDispose.push(edgeWireMat);

  const pinPadMat = new THREE.MeshBasicMaterial({
    color: 0x00d8ff,
    transparent: true,
    opacity: 0.8,
  });
  materialsToDispose.push(pinPadMat);

  function addChipBuilding(
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    isCentralCpu = false
  ) {
    const bGeo = new THREE.BoxGeometry(w, h, d);
    geometriesToDispose.push(bGeo);
    const mesh = new THREE.Mesh(bGeo, isCentralCpu ? cpuCapMat : chipBodyMat);
    mesh.position.set(x, h * 0.5, z);
    cityGroup.add(mesh);

    // Glowing blue architectural edge lines so every register & processor looks like a cyber-silicon building
    const edgesGeo = new THREE.EdgesGeometry(bGeo);
    geometriesToDispose.push(edgesGeo);
    const edgeLines = new THREE.LineSegments(edgesGeo, edgeWireMat);
    edgeLines.position.copy(mesh.position);
    cityGroup.add(edgeLines);

    // Rooftop register sub-cells / cache blocks
    if (h > 35 * S || isCentralCpu) {
      const capGeo = new THREE.BoxGeometry(w * 0.72, 6 * S, d * 0.72);
      geometriesToDispose.push(capGeo);
      const capMesh = new THREE.Mesh(capGeo, cpuCapMat);
      capMesh.position.set(x, h + 3 * S, z);
      cityGroup.add(capMesh);

      const capEdges = new THREE.EdgesGeometry(capGeo);
      geometriesToDispose.push(capEdges);
      const capLines = new THREE.LineSegments(capEdges, edgeWireMat);
      capLines.position.copy(capMesh.position);
      cityGroup.add(capLines);
    }
  }

  // 2. Central Processor Monument (ATmega328P / AI Vision Core) at (0, 0)
  addChipBuilding(0, 0, 170 * S, 42 * S, 170 * S, false);
  addChipBuilding(0, 0, 125 * S, 64 * S, 125 * S, true);

  // Processor socket pin array around central CPU
  const pinGeo = new THREE.BoxGeometry(6 * S, 3 * S, 14 * S);
  geometriesToDispose.push(pinGeo);
  for (let i = -5; i <= 5; i++) {
    const offset = i * 14 * S;
    // North & South pins
    const pN = new THREE.Mesh(pinGeo, pinPadMat);
    pN.position.set(offset, 2 * S, -96 * S);
    cityGroup.add(pN);
    const pS = new THREE.Mesh(pinGeo, pinPadMat);
    pS.position.set(offset, 2 * S, 96 * S);
    cityGroup.add(pS);
    // East & West pins
    const pE = new THREE.Mesh(pinGeo, pinPadMat);
    pE.rotation.y = Math.PI * 0.5;
    pE.position.set(96 * S, 2 * S, offset);
    cityGroup.add(pE);
    const pW = new THREE.Mesh(pinGeo, pinPadMat);
    pW.rotation.y = Math.PI * 0.5;
    pW.position.set(-96 * S, 2 * S, offset);
    cityGroup.add(pW);
  }

  // 3. Surrounding Register Banks, Memory Towers, & L298N Motor Driver Blocks (City Skyline)
  const registerBuildings: Array<[number, number, number, number, number]> = [
    // Inner Register Ring (Instruction / Data Registers)
    [-240, -160, 85, 95, 70],
    [-240, 10, 75, 68, 90],
    [-240, 180, 90, 82, 75],
    [240, -160, 85, 105, 70],
    [240, 10, 75, 74, 90],
    [240, 180, 90, 88, 75],
    [-110, -240, 95, 72, 65],
    [110, -240, 95, 78, 65],
    [-110, 250, 90, 56, 60],
    [110, 250, 90, 62, 60],

    // Mid-City Register Skyscrapers & L298N H-Bridge Towers
    [-430, -280, 110, 135, 95],
    [-430, -80, 85, 92, 85],
    [-430, 110, 95, 115, 80],
    [-430, 290, 105, 76, 90],

    [430, -280, 110, 142, 95],
    [430, -80, 85, 98, 85],
    [430, 110, 95, 120, 80],
    [430, 290, 105, 84, 90],

    // Far Horizon Silicon Towers
    [-640, -220, 120, 160, 110],
    [-640, 40, 100, 110, 95],
    [-640, 260, 115, 90, 100],
    [640, -220, 120, 165, 110],
    [640, 40, 100, 118, 95],
    [640, 260, 115, 94, 100],
    [-280, -420, 130, 125, 90],
    [0, -440, 150, 148, 100],
    [280, -420, 130, 130, 90],
  ];

  for (const [bx, bz, bw, bh, bd] of registerBuildings) {
    addChipBuilding(bx * S, bz * S, bw * S, bh * S, bd * S, false);
  }

  // 4. Glowing Blue PCB Current Path Lines (Orthogonal + 45-degree Manhattan Routing)
  const rawPaths: Array<{
    id: string;
    pts: Array<[number, number]>;
    speed: number;
    offset: number;
    motor?: 'fan1' | 'fan2';
  }> = [
    // Main West Bus (Processor -> West Registers -> Fan 1 L298N OUT1/OUT2)
    {
      id: 'bus_w1',
      pts: [
        [-85, -30],
        [-165, -30],
        [-195, -60],
        [-330, -60],
        [-330, -180],
        [-530, -180],
        [-530, -340],
        [-780, -340],
      ],
      speed: 0.24,
      offset: 0.0,
      motor: 'fan1',
    },
    {
      id: 'bus_w2',
      pts: [
        [-85, 0],
        [-175, 0],
        [-175, 95],
        [-340, 95],
        [-340, 200],
        [-540, 200],
        [-540, 360],
        [-780, 360],
      ],
      speed: 0.21,
      offset: 0.35,
      motor: 'fan1',
    },
    {
      id: 'bus_w3',
      pts: [
        [-85, 35],
        [-150, 35],
        [-150, 180],
        [-240, 180],
      ],
      speed: 0.32,
      offset: 0.6,
      motor: 'fan1',
    },
    // Main East Bus (Processor -> East Registers -> Fan 2 L298N OUT3/OUT4)
    {
      id: 'bus_e1',
      pts: [
        [85, -30],
        [165, -30],
        [195, -60],
        [330, -60],
        [330, -180],
        [530, -180],
        [530, -340],
        [780, -340],
      ],
      speed: 0.24,
      offset: 0.15,
      motor: 'fan2',
    },
    {
      id: 'bus_e2',
      pts: [
        [85, 0],
        [175, 0],
        [175, 95],
        [340, 95],
        [340, 200],
        [540, 200],
        [540, 360],
        [780, 360],
      ],
      speed: 0.21,
      offset: 0.5,
      motor: 'fan2',
    },
    {
      id: 'bus_e3',
      pts: [
        [85, 35],
        [150, 35],
        [150, 180],
        [240, 180],
      ],
      speed: 0.32,
      offset: 0.8,
      motor: 'fan2',
    },
    // North Camera Input Bus (Smartphone Camera Node -> Central Processor Core)
    {
      id: 'cam_n1',
      pts: [
        [-35, -560],
        [-35, -320],
        [-20, -300],
        [-20, -85],
      ],
      speed: 0.28,
      offset: 0.1,
    },
    {
      id: 'cam_n2',
      pts: [
        [35, -560],
        [35, -320],
        [20, -300],
        [20, -85],
      ],
      speed: 0.28,
      offset: 0.55,
    },
    {
      id: 'cam_n3',
      pts: [
        [-190, -520],
        [-190, -330],
        [-110, -330],
        [-60, -280],
        [-60, -85],
      ],
      speed: 0.22,
      offset: 0.25,
    },
    {
      id: 'cam_n4',
      pts: [
        [190, -520],
        [190, -330],
        [110, -330],
        [60, -280],
        [60, -85],
      ],
      speed: 0.22,
      offset: 0.75,
    },
    // South Register & Power Distribution Bus (12V Adapter & Common GND -> L298N & Registers)
    {
      id: 'pwr_s1',
      pts: [
        [-25, 85],
        [-25, 210],
        [-65, 250],
        [-65, 460],
      ],
      speed: 0.26,
      offset: 0.2,
    },
    {
      id: 'pwr_s2',
      pts: [
        [25, 85],
        [25, 210],
        [65, 250],
        [65, 460],
      ],
      speed: 0.26,
      offset: 0.7,
    },
    // Perimeter Ring Loop around the Register City
    {
      id: 'ring_loop',
      pts: [
        [-340, -330],
        [340, -330],
        [340, 330],
        [-340, 330],
        [-340, -330],
      ],
      speed: 0.14,
      offset: 0.0,
    },
    {
      id: 'outer_ring',
      pts: [
        [-540, -380],
        [540, -380],
        [540, 390],
        [-540, 390],
        [-540, -380],
      ],
      speed: 0.1,
      offset: 0.42,
    },
  ];

  const traceLineMat = new THREE.LineBasicMaterial({
    color: 0x0ea5e9,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
  });
  materialsToDispose.push(traceLineMat);

  const traceGlowMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
  });
  materialsToDispose.push(traceGlowMat);

  const traces: CircuitTraceDef[] = [];
  const traceY = 2.2 * S;

  for (const rp of rawPaths) {
    const waypoints: Vec3Point[] = rp.pts.map(([px, pz]) => ({
      x: px * S,
      y: traceY,
      z: pz * S,
    }));
    const def = buildCircuitTraceDef(rp.id, waypoints, rp.speed, rp.offset, rp.motor);
    traces.push(def);

    const points3D = waypoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points3D);
    geometriesToDispose.push(lineGeo);
    const line = new THREE.Line(lineGeo, traceLineMat);
    cityGroup.add(line);

    // Slightly elevated secondary glow line
    const glowPoints3D = waypoints.map((p) => new THREE.Vector3(p.x, p.y + 1.2 * S, p.z));
    const glowGeo = new THREE.BufferGeometry().setFromPoints(glowPoints3D);
    geometriesToDispose.push(glowGeo);
    const glowLine = new THREE.Line(glowGeo, traceGlowMat);
    cityGroup.add(glowLine);
  }

  // 5. Looping Moving Blue Current Points (with glowing core + trailing pulse beads)
  const pulseCanvas = document.createElement('canvas');
  pulseCanvas.width = 64;
  pulseCanvas.height = 64;
  const pCtx = pulseCanvas.getContext('2d');
  if (pCtx) {
    const grad = pCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.28, 'rgba(56, 189, 248, 0.95)');
    grad.addColorStop(0.65, 'rgba(2, 132, 199, 0.45)');
    grad.addColorStop(1, 'rgba(2, 132, 199, 0)');
    pCtx.fillStyle = grad;
    pCtx.fillRect(0, 0, 64, 64);
  }
  const pulseTex = new THREE.CanvasTexture(pulseCanvas);
  texturesToDispose.push(pulseTex);

  // Each trace has 2 primary packets, and each packet has 5 trail points (head + 4 tail beads)
  const packetsPerTrace = 2;
  const trailPerPacket = 5;
  const totalPulsePoints = traces.length * packetsPerTrace * trailPerPacket;

  const pulsePositions = new Float32Array(totalPulsePoints * 3);
  const pulseColors = new Float32Array(totalPulsePoints * 3);

  for (let i = 0; i < totalPulsePoints; i++) {
    const trailIdx = i % trailPerPacket;
    const intensity = Math.pow(1 - trailIdx / trailPerPacket, 1.35);
    // Bright white-cyan head fading to deep electric blue tail
    pulseColors[i * 3] = (trailIdx === 0 ? 0.85 : 0.15) * intensity;
    pulseColors[i * 3 + 1] = (trailIdx === 0 ? 0.98 : 0.78) * intensity;
    pulseColors[i * 3 + 2] = 1.0 * intensity;
  }

  const pulseGeo = new THREE.BufferGeometry();
  pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3));
  pulseGeo.setAttribute('color', new THREE.BufferAttribute(pulseColors, 3));
  geometriesToDispose.push(pulseGeo);

  const pulseMat = new THREE.PointsMaterial({
    size: Math.max(18, 28 * S),
    map: pulseTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  materialsToDispose.push(pulseMat);

  const pulsePointsMesh = new THREE.Points(pulseGeo, pulseMat);
  cityGroup.add(pulsePointsMesh);

  // Also add solid 3D glowing blue spheres for the leading current point on each trace
  const leadSphereGeo = new THREE.SphereGeometry(4.5 * S, 12, 12);
  geometriesToDispose.push(leadSphereGeo);
  const leadSphereMat = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.95,
  });
  materialsToDispose.push(leadSphereMat);

  const leadSpheres: THREE.Mesh[] = [];
  for (let i = 0; i < traces.length * packetsPerTrace; i++) {
    const sp = new THREE.Mesh(leadSphereGeo, leadSphereMat);
    cityGroup.add(sp);
    leadSpheres.push(sp);
  }

  let accumProgress = new Float32Array(traces.length);
  for (let i = 0; i < traces.length; i++) {
    accumProgress[i] = traces[i].phaseOffset;
  }

  return {
    rootGroup,
    update(timeSec, dt, opacity, pointerNormX, pointerNormY, fan1SpeedPct, fan2SpeedPct) {
      rootGroup.visible = opacity > 0.01;
      if (!rootGroup.visible) return;

      // Smoothly modulate materials with transition opacity
      boardMat.opacity = opacity;
      chipBodyMat.opacity = opacity;
      cpuCapMat.opacity = opacity;
      edgeWireMat.opacity = 0.55 * opacity;
      pinPadMat.opacity = 0.8 * opacity;
      traceLineMat.opacity = 0.88 * opacity;
      traceGlowMat.opacity = 0.42 * opacity;
      pulseMat.opacity = 0.98 * opacity;
      leadSphereMat.opacity = 0.95 * opacity;
      (gridMat as THREE.LineBasicMaterial).opacity = 0.32 * opacity;

      // Pulse central CPU core glow
      cpuCapMat.emissiveIntensity = 0.22 + 0.12 * Math.sin(timeSec * 3.2);

      // Gentle 3D camera parallax over the Processor & Register City
      const targetRotY = pointerNormX * 0.26;
      const targetRotX = -0.92 + pointerNormY * 0.14;
      cityGroup.rotation.y += (targetRotY - cityGroup.rotation.y) * Math.min(1, dt * 5);
      cityGroup.rotation.x += (targetRotX - cityGroup.rotation.x) * Math.min(1, dt * 5);

      const posAttr = pulseGeo.attributes.position as THREE.BufferAttribute;
      let ptCursor = 0;
      let sphereCursor = 0;

      for (let tIdx = 0; tIdx < traces.length; tIdx++) {
        const trace = traces[tIdx];
        // Scale current speed dynamically if it's a Fan 1 or Fan 2 motor trace
        let speedMult = 1.0;
        if (trace.isMotorTrace === 'fan1') {
          speedMult = 0.35 + (fan1SpeedPct / 100) * 1.35;
        } else if (trace.isMotorTrace === 'fan2') {
          speedMult = 0.35 + (fan2SpeedPct / 100) * 1.35;
        }

        accumProgress[tIdx] = (accumProgress[tIdx] + dt * trace.speed * speedMult) % 1;
        const baseT = accumProgress[tIdx];

        for (let p = 0; p < packetsPerTrace; p++) {
          const packetBaseT = (baseT + p * 0.5) % 1;

          for (let trail = 0; trail < trailPerPacket; trail++) {
            const sampleT = (packetBaseT - trail * 0.018 + 1) % 1;
            const pt = sampleCircuitTrace(trace, sampleT);
            posAttr.setXYZ(ptCursor, pt.x, pt.y + 2.5 * S, pt.z);
            if (trail === 0 && leadSpheres[sphereCursor]) {
              leadSpheres[sphereCursor].position.set(pt.x, pt.y + 2.5 * S, pt.z);
              sphereCursor++;
            }
            ptCursor++;
          }
        }
      }

      posAttr.needsUpdate = true;
    },
    dispose() {
      geometriesToDispose.forEach((g) => g.dispose());
      materialsToDispose.forEach((m) => m.dispose());
      texturesToDispose.forEach((t) => t.dispose());
    },
  };
}
