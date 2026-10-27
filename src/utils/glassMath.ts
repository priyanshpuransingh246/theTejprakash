import { Point2D } from './homography';

export type CellId = 'A' | 'B' | 'C' | 'D' | 'E';
export type PieceId = 'nav' | CellId;

export interface CutCell {
  id: CellId;
  /** Vertices in panel-normalised coordinates [0..1] (x right, y down) */
  normVertices: Point2D[];
}

export interface BlockLayout {
  W: number;
  H: number;
  marginX: number;
  marginY: number;
  blockWidth: number;
  blockHeight: number;
  navHeight: number;
  gapPx: number;
  panelWidth: number;
  panelHeight: number;
  S: number;
  kSliver: number;
  cameraZ: number;
  isPortrait: boolean;
  isPhone: boolean;
}

export interface SpringState {
  value: number;
  velocity: number;
}

export interface ShatterTrajectory {
  pieceId: PieceId;
  staggerSec: number;
  velX: number;
  velY: number;
  velZ: number;
  gravityY: number;
  tumbleAxis: [number, number, number];
  tumbleAngle: number;
}

export interface ShatterPose {
  dx: number;
  dy: number;
  dz: number;
  axis: [number, number, number];
  angle: number;
}

/**
 * Computes all layout dimensions and camera placement so 1 world unit = 1 CSS px at z = 0.
 */
export function computeBlockLayout(W: number, H: number): BlockLayout {
  const isPhone = W < 640;
  const isPortrait = H > W;
  const marginX = isPhone ? 16 : W * 0.055;
  const marginY = isPhone ? 16 : H * 0.085;
  const blockWidth = Math.max(240, W - 2 * marginX);
  const blockHeight = Math.max(240, H - 2 * marginY);
  const S = blockWidth / 1730;
  const navHeight = blockHeight * 0.108;
  const gapPx = 14;
  const panelWidth = blockWidth;
  const panelHeight = Math.max(160, blockHeight - navHeight - gapPx);
  const kSliver = W / 1918;

  // Perspective camera fov = 30 deg -> half-angle = 15 deg
  const halfFovRad = (15 * Math.PI) / 180;
  const cameraZ = H / 2 / Math.tan(halfFovRad);

  return {
    W,
    H,
    marginX,
    marginY,
    blockWidth,
    blockHeight,
    navHeight,
    gapPx,
    panelWidth,
    panelHeight,
    S,
    kSliver,
    cameraZ,
    isPortrait,
    isPhone,
  };
}

/**
 * Computes the 5 live cut cells (A, B, C, D, E) in panel-normalised coordinates (x right, y down).
 * Includes slow sine drift (x ±0.03; junctions also y ±0.05; periods 10–20s),
 * cursor push (points within 0.6 of pointer pushed away by up to 0.05),
 * and portrait screen transposition so hero cell A sits on top.
 */
export function getCutCells(
  timeSec: number,
  pointerPanelNorm: Point2D | null,
  pointerInfluence: number,
  isPortrait: boolean
): CutCell[] {
  const TWO_PI = Math.PI * 2;

  // Base coordinates with slow sine drift (periods 10-20s)
  const rawPoints = {
    TL: { x: 0, y: 0, edge: 'corner' as const },
    TR: { x: 1, y: 0, edge: 'corner' as const },
    BR: { x: 1, y: 1, edge: 'corner' as const },
    BL: { x: 0, y: 1, edge: 'corner' as const },
    tAB: {
      x: 0.22 + 0.03 * Math.sin((TWO_PI * timeSec) / 11.4 + 0.4),
      y: 0,
      edge: 'top' as const,
    },
    tBC: {
      x: 0.515 + 0.03 * Math.sin((TWO_PI * timeSec) / 14.8 + 1.9),
      y: 0,
      edge: 'top' as const,
    },
    tCE: {
      x: 0.84 + 0.03 * Math.sin((TWO_PI * timeSec) / 17.2 + 3.1),
      y: 0,
      edge: 'top' as const,
    },
    bAD: {
      x: 0.34 + 0.03 * Math.sin((TWO_PI * timeSec) / 12.9 + 2.3),
      y: 1,
      edge: 'bottom' as const,
    },
    bDE: {
      x: 0.865 + 0.03 * Math.sin((TWO_PI * timeSec) / 16.3 + 4.7),
      y: 1,
      edge: 'bottom' as const,
    },
    J0: {
      x: 0.385 + 0.03 * Math.sin((TWO_PI * timeSec) / 13.7 + 0.8),
      y: 0.72 + 0.05 * Math.sin((TWO_PI * timeSec) / 18.1 + 1.5),
      edge: 'inner' as const,
    },
    J1: {
      x: 0.48 + 0.03 * Math.sin((TWO_PI * timeSec) / 15.6 + 2.7),
      y: 0.62 + 0.05 * Math.sin((TWO_PI * timeSec) / 11.9 + 3.8),
      edge: 'inner' as const,
    },
    J2: {
      x: 0.716 + 0.03 * Math.sin((TWO_PI * timeSec) / 19.3 + 5.1),
      y: 0.49 + 0.05 * Math.sin((TWO_PI * timeSec) / 14.2 + 0.3),
      edge: 'inner' as const,
    },
  };

  // Transpose pattern for portrait screens so hero cell A sits on top
  const pts: Record<
    keyof typeof rawPoints,
    { x: number; y: number; mode: 'corner' | 'xOnly' | 'yOnly' | 'inner' }
  > = {} as any;

  for (const key of Object.keys(rawPoints) as Array<keyof typeof rawPoints>) {
    const p = rawPoints[key];
    if (!isPortrait) {
      pts[key] = {
        x: p.x,
        y: p.y,
        mode: p.edge === 'corner' ? 'corner' : p.edge === 'inner' ? 'inner' : 'xOnly',
      };
    } else {
      pts[key] = {
        x: p.y,
        y: p.x,
        mode: p.edge === 'corner' ? 'corner' : p.edge === 'inner' ? 'inner' : 'yOnly',
      };
    }
  }

  // Cursor push: points within 0.6 of the pointer are pushed away by up to 0.05
  if (pointerPanelNorm && pointerInfluence > 0) {
    const px = pointerPanelNorm.x;
    const py = pointerPanelNorm.y;
    const radius = 0.6;
    const maxPush = 0.05 * Math.min(1, Math.max(0, pointerInfluence));

    for (const key of Object.keys(pts) as Array<keyof typeof pts>) {
      const pt = pts[key];
      if (pt.mode === 'corner') continue;

      const dx = pt.x - px;
      const dy = pt.y - py;
      const dist = Math.hypot(dx, dy);
      if (dist < radius && dist > 1e-5) {
        const falloff = (1 - dist / radius) * (1 - dist / radius);
        const pushAmount = maxPush * falloff;
        const ux = dx / dist;
        const uy = dy / dist;

        if (pt.mode === 'xOnly') {
          pt.x = Math.min(0.94, Math.max(0.06, pt.x + ux * pushAmount));
        } else if (pt.mode === 'yOnly') {
          pt.y = Math.min(0.94, Math.max(0.06, pt.y + uy * pushAmount));
        } else if (pt.mode === 'inner') {
          pt.x = Math.min(0.92, Math.max(0.08, pt.x + ux * pushAmount));
          pt.y = Math.min(0.92, Math.max(0.08, pt.y + uy * pushAmount));
        }
      }
    }
  }

  // Build the 5 cells:
  // A = TL·tAB·J0·bAD·BL (hero)
  // B = tAB·tBC·J1·J0
  // C = tBC·tCE·J2·J1
  // D = J0·J1·J2·bDE·bAD
  // E = tCE·TR·BR·bDE·J2
  const defs: Array<{ id: CellId; keys: Array<keyof typeof pts> }> = [
    { id: 'A', keys: ['TL', 'tAB', 'J0', 'bAD', 'BL'] },
    { id: 'B', keys: ['tAB', 'tBC', 'J1', 'J0'] },
    { id: 'C', keys: ['tBC', 'tCE', 'J2', 'J1'] },
    { id: 'D', keys: ['J0', 'J1', 'J2', 'bDE', 'bAD'] },
    { id: 'E', keys: ['tCE', 'TR', 'BR', 'bDE', 'J2'] },
  ];

  return defs.map(({ id, keys }) => {
    const orderedKeys = isPortrait ? [...keys].reverse() : keys;
    return {
      id,
      normVertices: orderedKeys.map((k) => ({ x: pts[k].x, y: pts[k].y })),
    };
  });
}

/**
 * Computes the signed area of a 2D polygon (positive if counter-clockwise in standard math coords).
 */
export function polygonSignedArea(pts: Point2D[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return area * 0.5;
}

/**
 * Computes the geometric centroid of a 2D polygon.
 */
export function polygonCentroid(pts: Point2D[]): Point2D {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const cross = p1.x * p2.y - p2.x * p1.y;
    area2 += cross;
    cx += (p1.x + p2.x) * cross;
    cy += (p1.y + p2.y) * cross;
  }
  if (Math.abs(area2) < 1e-5) {
    const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / n, y: sum.y / n };
  }
  return {
    x: cx / (3 * area2),
    y: cy / (3 * area2),
  };
}

/**
 * Insets every edge of a counter-clockwise polygon inward by `insetDist`.
 */
export function insetPolygonCCW(pts: Point2D[], insetDist: number): Point2D[] {
  const n = pts.length;
  if (n < 3 || Math.abs(insetDist) < 1e-6) return pts.map((p) => ({ ...p }));

  // Ensure CCW winding
  const area = polygonSignedArea(pts);
  const ccwPts = area >= 0 ? pts : [...pts].reverse();

  // Each directed edge P_i -> P_{i+1} has inward unit normal (-dy, dx) / len
  const lines: Array<{ p: Point2D; dir: Point2D }> = [];
  for (let i = 0; i < n; i++) {
    const p1 = ccwPts[i];
    const p2 = ccwPts[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Inward normal for CCW polygon is (-uy, ux)
    const nx = -uy;
    const ny = ux;
    lines.push({
      p: { x: p1.x + nx * insetDist, y: p1.y + ny * insetDist },
      dir: { x: ux, y: uy },
    });
  }

  const result: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const prevLine = lines[(i - 1 + n) % n];
    const currLine = lines[i];
    const denom = prevLine.dir.x * currLine.dir.y - prevLine.dir.y * currLine.dir.x;
    if (Math.abs(denom) < 1e-5) {
      result.push({ ...currLine.p });
    } else {
      const dx = currLine.p.x - prevLine.p.x;
      const dy = currLine.p.y - prevLine.p.y;
      const t = (dx * currLine.dir.y - dy * currLine.dir.x) / denom;
      result.push({
        x: prevLine.p.x + prevLine.dir.x * t,
        y: prevLine.p.y + prevLine.dir.y * t,
      });
    }
  }

  return result;
}

/**
 * Generates a dense sequence of 2D points representing a polygon with rounded corners
 * of radius `cornerRadius`. Automatically clamps tangent distances on acute corners.
 */
export function buildRoundedPolygonPoints(
  pts: Point2D[],
  cornerRadius: number,
  arcSegments = 8
): Point2D[] {
  const n = pts.length;
  if (n < 3) return pts;

  const area = polygonSignedArea(pts);
  const ccwPts = area >= 0 ? pts : [...pts].reverse();

  const out: Point2D[] = [];

  for (let i = 0; i < n; i++) {
    const prev = ccwPts[(i - 1 + n) % n];
    const curr = ccwPts[i];
    const next = ccwPts[(i + 1) % n];

    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const len1 = Math.hypot(v1x, v1y) || 1;
    const u1x = v1x / len1;
    const u1y = v1y / len1;

    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len2 = Math.hypot(v2x, v2y) || 1;
    const u2x = v2x / len2;
    const u2y = v2y / len2;

    const dot = Math.max(-0.999, Math.min(0.999, u1x * u2x + u1y * u2y));
    const halfAngle = Math.acos(dot) * 0.5;
    const tanHalf = Math.tan(halfAngle);

    if (tanHalf < 1e-4 || cornerRadius <= 0.1) {
      out.push({ x: curr.x, y: curr.y });
      continue;
    }

    const idealDist = cornerRadius / tanHalf;
    const maxDist = Math.min(len1, len2) * 0.44;
    const tangentDist = Math.min(idealDist, maxDist);
    const effectiveRadius = tangentDist * tanHalf;

    // Start and end points of the corner arc
    const startX = curr.x + u1x * tangentDist;
    const startY = curr.y + u1y * tangentDist;
    const endX = curr.x + u2x * tangentDist;
    const endY = curr.y + u2y * tangentDist;

    // Bisector direction pointing into the polygon interior
    let bx = u1x + u2x;
    let by = u1y + u2y;
    const bLen = Math.hypot(bx, by) || 1;
    bx /= bLen;
    by /= bLen;

    const centerDist = Math.hypot(tangentDist, effectiveRadius);
    const cx = curr.x + bx * centerDist;
    const cy = curr.y + by * centerDist;

    const angStart = Math.atan2(startY - cy, startX - cx);
    let angEnd = Math.atan2(endY - cy, endX - cx);

    // Ensure shortest positive/negative sweep
    let deltaAng = angEnd - angStart;
    while (deltaAng <= -Math.PI) deltaAng += Math.PI * 2;
    while (deltaAng > Math.PI) deltaAng -= Math.PI * 2;

    for (let s = 0; s <= arcSegments; s++) {
      const t = s / arcSegments;
      const ang = angStart + deltaAng * t;
      out.push({
        x: cx + Math.cos(ang) * effectiveRadius,
        y: cy + Math.sin(ang) * effectiveRadius,
      });
    }
  }

  return out;
}

/**
 * Second-order spring integrator (default k = 170, c = 19).
 */
export function stepSpring(
  state: SpringState,
  target: number,
  dt: number,
  k = 170,
  c = 19
): SpringState {
  // Substep for numerical stability at low frame rates
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  const subDt = Math.min(dt, 0.1) / steps;
  let val = state.value;
  let vel = state.velocity;

  for (let i = 0; i < steps; i++) {
    const force = -k * (val - target) - c * vel;
    vel += force * subDt;
    val += vel * subDt;
  }

  return { value: val, velocity: vel };
}

/**
 * Computes the hover tip angles (rotX, rotY in radians, up to ±0.24 rad)
 * so the edge nearest the pointer dips away (-Z).
 */
export function computeHoverTip(
  pointerWorld: Point2D,
  pieceCenterWorld: Point2D,
  pieceRadius: number,
  maxRad = 0.24
): { rotX: number; rotY: number } {
  const safeR = Math.max(40, pieceRadius);
  const dx = Math.max(-1, Math.min(1, (pointerWorld.x - pieceCenterWorld.x) / safeR));
  const dy = Math.max(-1, Math.min(1, (pointerWorld.y - pieceCenterWorld.y) / safeR));

  // In right-handed Three.js coords (+X right, +Y up, +Z out toward viewer):
  // z_delta = -dx * sin(rotY) + dy * sin(rotX)
  // For the edge nearest the pointer to dip away (z_delta < 0):
  // rotY has the same sign as dx, and rotX has the opposite sign to dy.
  return {
    rotX: -dy * maxRad,
    rotY: dx * maxRad,
  };
}

/**
 * Ease-in cubic (t^3) used for the 0.72s shatter fly-off.
 */
export function easeInCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c;
}

/**
 * Ease-out back (slight overshoot) used for the 0.72s reassemble & initial load fly-in.
 */
export function easeOutBack(t: number, overshoot = 1.15): number {
  const c = Math.max(0, Math.min(1, t));
  const c1 = overshoot;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
}

/**
 * Deterministic trajectory parameters per shard so "Back" flies back along the exact same paths.
 */
export function createShatterTrajectories(S: number): Record<PieceId, ShatterTrajectory> {
  return {
    nav: {
      pieceId: 'nav',
      staggerSec: 0.0,
      velX: -310 * S,
      velY: 195 * S,
      velZ: 420 * S,
      gravityY: 320 * S,
      tumbleAxis: normalize3([0.78, 0.42, -0.46]),
      tumbleAngle: 2.25,
    },
    A: {
      pieceId: 'A',
      staggerSec: 0.03,
      velX: -245 * S,
      velY: 230 * S,
      velZ: 435 * S,
      gravityY: 500 * S,
      tumbleAxis: normalize3([-0.55, 0.76, 0.34]),
      tumbleAngle: 2.35,
    },
    B: {
      pieceId: 'B',
      staggerSec: 0.06,
      velX: -350 * S,
      velY: 380 * S,
      velZ: 445 * S,
      gravityY: 360 * S,
      tumbleAxis: normalize3([0.64, 0.58, -0.5]),
      tumbleAngle: 2.55,
    },
    C: {
      pieceId: 'C',
      staggerSec: 0.09,
      velX: 255 * S,
      velY: 370 * S,
      velZ: 455 * S,
      gravityY: 360 * S,
      tumbleAxis: normalize3([0.48, -0.72, 0.5]),
      tumbleAngle: 2.65,
    },
    D: {
      pieceId: 'D',
      staggerSec: 0.12,
      velX: -380 * S,
      velY: -10 * S,
      velZ: 440 * S,
      gravityY: 420 * S,
      tumbleAxis: normalize3([-0.74, -0.45, -0.5]),
      tumbleAngle: 2.45,
    },
    E: {
      pieceId: 'E',
      staggerSec: 0.15,
      velX: 235 * S,
      velY: 55 * S,
      velZ: 425 * S,
      gravityY: 420 * S,
      tumbleAxis: normalize3([0.42, 0.81, -0.41]),
      tumbleAngle: 2.4,
    },
  };
}

/**
 * Evaluates a piece's displacement and tumble rotation along its shatter path.
 * `u = 0` is assembled rest pose; `u = 1` is fully shattered off-screen/camera-ward.
 */
export function evaluateShatterPose(traj: ShatterTrajectory, u: number): ShatterPose {
  const dx = traj.velX * u || 0;
  const dy = traj.velY * u - 0.5 * traj.gravityY * u * Math.abs(u) || 0;
  const dz = traj.velZ * u || 0;
  const angle = traj.tumbleAngle * u || 0;
  return {
    dx,
    dy,
    dz,
    axis: traj.tumbleAxis,
    angle,
  };
}

/**
 * Returns the 4 vertices of the "← Back" sliver shard in Three.js world coordinates (z = 0),
 * plus its centroid, from the prompt's viewport fractions:
 * (.147,.243) (.252,.169) (.287,.277) (.151,.258)
 */
export function getBackSliverPolygon(W: number, H: number): {
  worldVertices: Point2D[];
  localVertices: Point2D[];
  centerWorld: Point2D;
} {
  const fractions: Array<[number, number]> = [
    [0.147, 0.243],
    [0.252, 0.169],
    [0.287, 0.277],
    [0.151, 0.258],
  ];

  // Convert viewport fractions (x right, y down) to world coords at z=0 (+X right, +Y up)
  const worldVertices = fractions.map(([fx, fy]) => ({
    x: fx * W - W * 0.5,
    y: H * 0.5 - fy * H,
  }));

  // Anchor around the prompt's specified label center (.219 W, .238 H)
  const centerWorld = {
    x: 0.219 * W - W * 0.5,
    y: H * 0.5 - 0.238 * H,
  };

  // Reverse so vertices are counter-clockwise in (+X right, +Y up)
  const ccwWorld = [...worldVertices].reverse();
  const localVertices = ccwWorld.map((p) => ({
    x: p.x - centerWorld.x,
    y: p.y - centerWorld.y,
  }));

  return {
    worldVertices: ccwWorld,
    localVertices,
    centerWorld,
  };
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
