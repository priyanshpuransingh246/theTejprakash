export interface Point2D {
  x: number;
  y: number;
}

/**
 * Solves an 8x8 linear system A * h = b via Gaussian elimination with partial pivoting
 * to find the 2D projective homography mapping 4 source points to 4 destination points,
 * and returns a CSS matrix3d(...) string for a DOM element with transform-origin: 0 0.
 */
export function computeHomographyMatrix3d(
  src: [Point2D, Point2D, Point2D, Point2D],
  dst: [Point2D, Point2D, Point2D, Point2D]
): string {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);

    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem8x8(A, b);
  if (!h) {
    return 'matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)';
  }

  const [h11, h12, h13, h21, h22, h23, h31, h32] = h;

  // CSS matrix3d is column-major:
  // [ h11  h12   0   h13 ]
  // [ h21  h22   0   h23 ]
  // [  0    0    1    0  ]
  // [ h31  h32   0    1  ]
  const m = [
    h11, h21, 0, h31,
    h12, h22, 0, h32,
    0,   0,   1, 0,
    h13, h23, 0, 1,
  ];

  return `matrix3d(${m.map((v) => (Math.abs(v) < 1e-10 ? '0' : v.toFixed(8))).join(',')})`;
}

/**
 * Projects a 2D point through the solved homography (used in unit tests).
 */
export function projectPointHomography(
  pt: Point2D,
  src: [Point2D, Point2D, Point2D, Point2D],
  dst: [Point2D, Point2D, Point2D, Point2D]
): Point2D {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem8x8(A, b);
  if (!h) return { ...pt };

  const [h11, h12, h13, h21, h22, h23, h31, h32] = h;
  const w = h31 * pt.x + h32 * pt.y + 1;
  if (Math.abs(w) < 1e-8) return { ...pt };
  return {
    x: (h11 * pt.x + h12 * pt.y + h13) / w,
    y: (h21 * pt.x + h22 * pt.y + h23) / w,
  };
}

function solveLinearSystem8x8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(M[row][col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = row;
      }
    }

    if (maxVal < 1e-12) return null;

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let j = col; j <= n; j++) {
      M[col][j] /= pivot;
    }

    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = M[row][col];
        if (Math.abs(factor) > 1e-15) {
          for (let j = col; j <= n; j++) {
            M[row][j] -= factor * M[col][j];
          }
        }
      }
    }
  }

  return M.map((row) => row[n]);
}
