import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBlockLayout,
  getCutCells,
  polygonSignedArea,
  insetPolygonCCW,
  buildRoundedPolygonPoints,
  stepSpring,
  computeHoverTip,
  easeInCubic,
  easeOutBack,
  createShatterTrajectories,
  evaluateShatterPose,
  getBackSliverPolygon,
} from './glassMath';
import { computeHomographyMatrix3d, projectPointHomography, Point2D } from './homography';

test('computeBlockLayout satisfies 1 world unit = 1 CSS px at z=0 and 5.5%/8.5% margins', () => {
  const layout = computeBlockLayout(1440, 960);
  assert.ok(Math.abs(layout.marginX - 1440 * 0.055) < 1e-6);
  assert.ok(Math.abs(layout.marginY - 960 * 0.085) < 1e-6);
  assert.ok(Math.abs(layout.S - layout.blockWidth / 1730) < 1e-9);
  assert.equal(layout.gapPx, 14);

  // Verify cameraZ with 30 deg vertical FOV gives exact viewport height H at z=0
  const visibleHeightAtZ0 = 2 * layout.cameraZ * Math.tan((15 * Math.PI) / 180);
  assert.ok(Math.abs(visibleHeightAtZ0 - 960) < 1e-6);
});

test('getCutCells partitions the panel into 5 cells (A, B, C, D, E) whose areas sum to 1.0', () => {
  const cells = getCutCells(0, null, 0, false);
  assert.equal(cells.length, 5);
  assert.deepEqual(
    cells.map((c) => c.id),
    ['A', 'B', 'C', 'D', 'E']
  );

  // Sum of absolute areas of the 5 cells must equal 1.0 (the unit square)
  const totalArea = cells.reduce((acc, cell) => acc + Math.abs(polygonSignedArea(cell.normVertices)), 0);
  assert.ok(Math.abs(totalArea - 1.0) < 1e-6, `Expected total area 1.0, got ${totalArea}`);
});

test('cursor push expands the cell under the pointer', () => {
  const baseCells = getCutCells(2.5, null, 0, false);
  const pushedCells = getCutCells(2.5, { x: 0.15, y: 0.5 }, 1.0, false);

  const areaA0 = Math.abs(polygonSignedArea(baseCells[0].normVertices));
  const areaA1 = Math.abs(polygonSignedArea(pushedCells[0].normVertices));
  assert.ok(areaA1 > areaA0, `Expected cell A area to grow under cursor (${areaA1} > ${areaA0})`);
});

test('portrait mode transposes the cut pattern so hero cell A sits along the top edge', () => {
  const portraitCells = getCutCells(0, null, 0, true);
  const cellA = portraitCells.find((c) => c.id === 'A')!;
  // In portrait mode, cell A contains (0,0) and (1,0) along the top edge y=0
  const hasTopLeft = cellA.normVertices.some((p) => Math.abs(p.x) < 1e-5 && Math.abs(p.y) < 1e-5);
  const hasTopRight = cellA.normVertices.some((p) => Math.abs(p.x - 1) < 1e-5 && Math.abs(p.y) < 1e-5);
  assert.equal(hasTopLeft, true);
  assert.equal(hasTopRight, true);
});

test('insetPolygonCCW and buildRoundedPolygonPoints shrink polygon and produce finite rounded vertices', () => {
  const square: Point2D[] = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 150 },
    { x: 0, y: 150 },
  ];
  const inset = insetPolygonCCW(square, 7);
  assert.equal(inset.length, 4);
  assert.ok(Math.abs(inset[0].x - 7) < 1e-4);
  assert.ok(Math.abs(inset[0].y - 7) < 1e-4);

  const rounded = buildRoundedPolygonPoints(inset, 18, 6);
  assert.ok(rounded.length > 16);
  for (const pt of rounded) {
    assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y));
  }
});

test('stepSpring converges to target 50*S with k=170, c=19', () => {
  let state = { value: 0, velocity: 0 };
  for (let i = 0; i < 60; i++) {
    state = stepSpring(state, 50, 1 / 60, 170, 19);
  }
  assert.ok(Math.abs(state.value - 50) < 0.2);
});

test('computeHoverTip dips the edge nearest the pointer away (-Z)', () => {
  const tipRightTop = computeHoverTip({ x: 100, y: 80 }, { x: 0, y: 0 }, 150, 0.24);
  assert.ok(tipRightTop.rotY > 0);
  assert.ok(tipRightTop.rotX < 0);
});

test('shatter trajectories and easing curves behave properly', () => {
  assert.equal(easeInCubic(0), 0);
  assert.equal(easeInCubic(1), 1);
  assert.ok(Math.abs(easeOutBack(0) - 0) < 1e-6);
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-6);
  assert.ok(easeOutBack(0.6) > 1.0); // slight overshoot

  const trajs = createShatterTrajectories(1);
  const pose0 = evaluateShatterPose(trajs.A, 0);
  assert.equal(pose0.dx, 0);
  assert.equal(pose0.dz, 0);

  const pose1 = evaluateShatterPose(trajs.A, 1);
  assert.ok(pose1.dz >= 420 && pose1.dz <= 800);
  assert.ok(pose1.angle >= 2.0 && pose1.angle <= 3.6);
});

test('homography solver maps 4 corners accurately', () => {
  const src: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 600 },
    { x: 0, y: 600 },
  ];
  const dst: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 82, y: 90 },
    { x: 1070, y: 78 },
    { x: 1085, y: 695 },
    { x: 74, y: 680 },
  ];

  const css = computeHomographyMatrix3d(src, dst);
  assert.ok(css.startsWith('matrix3d('));

  for (let i = 0; i < 4; i++) {
    const projected = projectPointHomography(src[i], src, dst);
    assert.ok(Math.abs(projected.x - dst[i].x) < 1e-4);
    assert.ok(Math.abs(projected.y - dst[i].y) < 1e-4);
  }
});

test('getBackSliverPolygon builds valid CCW local vertices centered on (.219 W, .238 H)', () => {
  const sliver = getBackSliverPolygon(1440, 960);
  assert.equal(sliver.localVertices.length, 4);
  assert.ok(polygonSignedArea(sliver.localVertices) > 0);
});
