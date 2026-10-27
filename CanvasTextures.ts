import { BlockLayout } from '../utils/glassMath';

export interface InteractiveHoverState {
  openStudioHovered: boolean;
  controllerHovered: boolean;
  readPaperHovered: boolean;
  hoveredNavLink: 'studio' | 'materials' | 'pricing' | 'signin' | null;
  backHovered: boolean;
  activeMaterialLabel?: string;
}

export interface PanelLayoutMetrics {
  padX: number;
  eyebrowY: number;
  eyebrowFontPx: number;
  headlineY: number;
  headlineFontPx: number;
  headlineLineHeight: number;
  subY: number;
  subFontPx: number;
  subLineHeight: number;
  ctaY: number;
  pillW: number;
  pillH: number;
  pillRadius: number;
  pillFontPx: number;
  controllerPillX: number;
  controllerPillW: number;
  readPaperX: number;
  readPaperY: number;
  readPaperFontPx: number;
  footerY: number;
  footerFontPx: number;
  navPadX: number;
  navFontPx: number;
}

/**
 * Computes consistent pixel metrics for both the 2D Canvas texture renderer
 * and the homography-transformed selectable DOM text layer.
 */
export function computePanelMetrics(layout: BlockLayout): PanelLayoutMetrics {
  const { panelWidth, panelHeight, S, isPhone } = layout;
  const effS = Math.max(0.58, S);

  const padX = isPhone ? 24 : Math.max(36, 68 * S);
  const eyebrowFontPx = Math.max(9.5, 11 * effS);
  const eyebrowY = panelHeight * 0.135;

  const headlineFontPx = Math.min(panelWidth * 0.078, panelHeight * 0.2);
  const headlineLineHeight = headlineFontPx * 0.97;
  const headlineY = eyebrowY + eyebrowFontPx + Math.max(18, 28 * effS);

  const subFontPx = Math.max(12.5, 17 * effS);
  const subLineHeight = subFontPx * 1.52;
  const subY = headlineY + headlineLineHeight * 2 + Math.max(18, 32 * effS);

  const pillW = Math.max(96, 116 * effS);
  const pillH = Math.max(32, 40 * effS);
  const pillRadius = Math.max(4, 6 * effS);
  const pillFontPx = Math.max(11.5, 13.5 * effS);
  const ctaY = subY + subLineHeight * 2 + Math.max(20, 36 * effS);

  const btnGap = Math.max(10, 14 * effS);
  const controllerPillX = padX + pillW + btnGap;
  const controllerPillW = Math.max(102, 122 * effS);

  const readPaperFontPx = Math.max(12, 14 * effS);
  const readPaperX = controllerPillX + controllerPillW + Math.max(16, 24 * effS);
  const readPaperY = ctaY + pillH * 0.5;

  const footerFontPx = Math.max(9.5, 11 * effS);
  const footerY = panelHeight - Math.max(20, 34 * effS);

  const navPadX = padX;
  const navFontPx = Math.max(11.5, 13.5 * effS);

  return {
    padX,
    eyebrowY,
    eyebrowFontPx,
    headlineY,
    headlineFontPx,
    headlineLineHeight,
    subY,
    subFontPx,
    subLineHeight,
    ctaY,
    pillW,
    pillH,
    pillRadius,
    pillFontPx,
    controllerPillX,
    controllerPillW,
    readPaperX,
    readPaperY,
    readPaperFontPx,
    footerY,
    footerFontPx,
    navPadX,
    navFontPx,
  };
}

/**
 * Draws the main shard panel content onto a high-DPI 2D canvas for "The Tejprakash":
 * - Eyebrow "THE TEJPRAKASH · ENERGY CONSERVATION SOFTWARE"
 * - Headline "Smart class, / zero waste."
 * - Two-line sub explaining smartphone camera + AI & manual fan speed control
 * - "Camera" light pill (turns #36d67e on hover) + "Controller" bordered pill
 * - "System rules →" shatter link
 * - "© The Tejprakash" bottom-left and "Arduino UNO · L298N · Dual DC Fans" bottom-right
 */
export function drawPanelCanvas(
  canvas: HTMLCanvasElement,
  layout: BlockLayout,
  hover: InteractiveHoverState,
  dpr = 2
): PanelLayoutMetrics {
  const { panelWidth, panelHeight } = layout;
  const targetW = Math.max(1, Math.round(panelWidth * dpr));
  const targetH = Math.max(1, Math.round(panelHeight * dpr));

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext('2d');
  const metrics = computePanelMetrics(layout);
  if (!ctx) return metrics;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, panelWidth, panelHeight);

  const fontStack = `'InterVar', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif`;

  // 1. Eyebrow: "THE TEJPRAKASH · ENERGY CONSERVATION"
  ctx.font = `500 ${metrics.eyebrowFontPx}px ${fontStack}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.textBaseline = 'alphabetic';
  drawTrackedText(
    ctx,
    'THE TEJPRAKASH · ENERGY CONSERVATION',
    metrics.padX,
    metrics.eyebrowY,
    metrics.eyebrowFontPx * 0.2
  );

  // 2. Headline: "Smart class, / zero waste."
  // Inter 500, size min(7.8% of panel width, 20% of height), tracking -.045em, leading .97, #dcdce0 -> #bdbdc3 gradient
  ctx.font = `500 ${metrics.headlineFontPx}px ${fontStack}`;
  ctx.textBaseline = 'top';
  const gradTop = metrics.headlineY;
  const gradBottom = metrics.headlineY + metrics.headlineLineHeight * 2;
  const headlineGrad = ctx.createLinearGradient(0, gradTop, 0, gradBottom);
  headlineGrad.addColorStop(0, '#dcdce0');
  headlineGrad.addColorStop(1, '#bdbdc3');
  ctx.fillStyle = headlineGrad;

  const headlineTracking = -0.045 * metrics.headlineFontPx;
  drawTrackedText(ctx, 'Smart class,', metrics.padX, metrics.headlineY, headlineTracking);
  drawTrackedText(
    ctx,
    'zero waste.',
    metrics.padX,
    metrics.headlineY + metrics.headlineLineHeight,
    headlineTracking
  );

  // 3. Two-line sub: 55% white
  ctx.font = `400 ${metrics.subFontPx}px ${fontStack}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.textBaseline = 'top';
  ctx.fillText(
    'Automated classroom fan and lighting control powered by live camera vision.',
    metrics.padX,
    metrics.subY
  );
  ctx.fillText(
    'Pair a smartphone camera with AI occupancy rules or manual L298N motor control.',
    metrics.padX,
    metrics.subY + metrics.subLineHeight
  );

  // 4a. "Camera" light pill (turns green #36d67e on hover)
  ctx.save();
  roundRectPath(ctx, metrics.padX, metrics.ctaY, metrics.pillW, metrics.pillH, metrics.pillRadius);
  ctx.fillStyle = hover.openStudioHovered ? '#36d67e' : '#ededf0';
  ctx.fill();

  ctx.font = `500 ${metrics.pillFontPx}px ${fontStack}`;
  ctx.fillStyle = '#09090c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    'Camera',
    metrics.padX + metrics.pillW * 0.5,
    metrics.ctaY + metrics.pillH * 0.5 + 0.5
  );
  ctx.restore();

  // 4b. "Controller" dark-glass bordered pill (turns #36d67e border/tint on hover)
  ctx.save();
  roundRectPath(
    ctx,
    metrics.controllerPillX,
    metrics.ctaY,
    metrics.controllerPillW,
    metrics.pillH,
    metrics.pillRadius
  );
  ctx.fillStyle = hover.controllerHovered
    ? 'rgba(54, 214, 126, 0.18)'
    : 'rgba(255, 255, 255, 0.08)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.2 * Math.max(0.6, layout.S));
  ctx.strokeStyle = hover.controllerHovered
    ? '#36d67e'
    : 'rgba(255, 255, 255, 0.24)';
  ctx.stroke();

  ctx.font = `500 ${metrics.pillFontPx}px ${fontStack}`;
  ctx.fillStyle = hover.controllerHovered ? '#36d67e' : 'rgba(255, 255, 255, 0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    'Controller',
    metrics.controllerPillX + metrics.controllerPillW * 0.5,
    metrics.ctaY + metrics.pillH * 0.5 + 0.5
  );
  ctx.restore();

  // 5. "System rules →" link (underlines on hover)
  ctx.save();
  ctx.font = `500 ${metrics.readPaperFontPx}px ${fontStack}`;
  ctx.fillStyle = hover.readPaperHovered
    ? 'rgba(255, 255, 255, 0.96)'
    : 'rgba(255, 255, 255, 0.78)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const readText = 'System rules →';
  ctx.fillText(readText, metrics.readPaperX, metrics.readPaperY);

  if (hover.readPaperHovered) {
    const textW = ctx.measureText(readText).width;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(1, 1.2 * Math.max(0.6, layout.S));
    ctx.beginPath();
    ctx.moveTo(metrics.readPaperX, metrics.readPaperY + metrics.readPaperFontPx * 0.58);
    ctx.lineTo(metrics.readPaperX + textW, metrics.readPaperY + metrics.readPaperFontPx * 0.58);
    ctx.stroke();
  }
  ctx.restore();

  // 6. "© The Tejprakash" bottom-left and "Arduino UNO · L298N · Dual DC Fans" bottom-right, 11·S px at 34% white
  ctx.font = `400 ${metrics.footerFontPx}px ${fontStack}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('© The Tejprakash · B.Tech AIML Project', metrics.padX, metrics.footerY);

  ctx.textAlign = 'right';
  const rightCaption = hover.activeMaterialLabel
    ? `Arduino UNO · L298N · ${hover.activeMaterialLabel}`
    : 'Arduino UNO SMD · L298N · Dual DC Fans';
  ctx.fillText(rightCaption, panelWidth - metrics.padX, metrics.footerY);

  ctx.restore();
  return metrics;
}

/**
 * Draws the nav slab content onto a high-DPI 2D canvas:
 * square mark + "The Tejprakash", links "Camera · Controller · AI Rules" (60% white, brighten on hover), "Arduino USB" right.
 */
export function drawNavCanvas(
  canvas: HTMLCanvasElement,
  layout: BlockLayout,
  hover: InteractiveHoverState,
  dpr = 2
): void {
  const { blockWidth, navHeight, S } = layout;
  const targetW = Math.max(1, Math.round(blockWidth * dpr));
  const targetH = Math.max(1, Math.round(navHeight * dpr));

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const metrics = computePanelMetrics(layout);
  const effS = Math.max(0.58, S);
  const fontStack = `'InterVar', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif`;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, blockWidth, navHeight);

  const midY = navHeight * 0.5;
  const padX = metrics.navPadX;

  // Square mark + "The Tejprakash"
  const sqSize = Math.max(11, 14 * effS);
  const sqX = padX;
  const sqY = midY - sqSize * 0.5;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  roundRectPath(ctx, sqX, sqY, sqSize, sqSize, Math.max(2, 3 * effS));
  ctx.fill();

  // Inner facet cut line inside square mark
  ctx.strokeStyle = '#141418';
  ctx.lineWidth = Math.max(1.2, 1.5 * effS);
  ctx.beginPath();
  ctx.moveTo(sqX + sqSize * 0.28, sqY);
  ctx.lineTo(sqX + sqSize * 0.72, sqY + sqSize);
  ctx.stroke();

  const brandFontPx = Math.max(12.5, 15 * effS);
  ctx.font = `600 ${brandFontPx}px ${fontStack}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('The Tejprakash', sqX + sqSize + Math.max(8, 10 * effS), midY + 0.5);

  // Center links: "Camera · Controller · AI Rules"
  if (!layout.isPhone) {
    ctx.font = `400 ${metrics.navFontPx}px ${fontStack}`;
    const items: Array<{ key: 'studio' | 'materials' | 'pricing'; label: string }> = [
      { key: 'studio', label: 'Camera' },
      { key: 'materials', label: 'Controller' },
      { key: 'pricing', label: 'AI Rules' },
    ];
    const dot = '   ·   ';
    const dotW = ctx.measureText(dot).width;
    const widths = items.map((item) => ctx.measureText(item.label).width);
    const totalW = widths.reduce((a, b) => a + b, 0) + dotW * 2;
    let curX = (blockWidth - totalW) * 0.5;

    items.forEach((item, idx) => {
      const isHov = hover.hoveredNavLink === item.key;
      ctx.fillStyle = isHov ? 'rgba(255, 255, 255, 0.96)' : 'rgba(255, 255, 255, 0.60)';
      ctx.fillText(item.label, curX, midY + 0.5);
      curX += widths[idx];

      if (idx < items.length - 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillText(dot, curX, midY + 0.5);
        curX += dotW;
      }
    });
  }

  // Right: "Manual / AI"
  ctx.font = `500 ${metrics.navFontPx}px ${fontStack}`;
  ctx.fillStyle =
    hover.hoveredNavLink === 'signin'
      ? 'rgba(255, 255, 255, 0.98)'
      : 'rgba(255, 255, 255, 0.76)';
  ctx.textAlign = 'right';
  ctx.fillText('Manual / AI', blockWidth - padX, midY + 0.5);

  ctx.restore();
}

/**
 * Draws the "← Back" label onto the 3D sliver texture.
 * Centered at (.219 W, .238 H), .66vw Inter 500, white (turns lavender #b9aee8 on hover).
 */
export function drawBackSliverCanvas(
  canvas: HTMLCanvasElement,
  W: number,
  backHover: boolean
): void {
  const dpr = 2;
  const logicalW = Math.max(110, Math.round(150 * (W / 1918)));
  const logicalH = Math.max(54, Math.round(75 * (W / 1918)));
  const texW = logicalW * dpr;
  const texH = logicalH * dpr;

  if (canvas.width !== texW || canvas.height !== texH) {
    canvas.width = texW;
    canvas.height = texH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, logicalW, logicalH);

  const fontStack = `'InterVar', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif`;
  const fontSize = Math.max(11.5, W * 0.0066);
  ctx.font = `500 ${fontSize}px ${fontStack}`;
  ctx.fillStyle = backHover ? '#b9aee8' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('← Back', logicalW * 0.5, logicalH * 0.5);
  ctx.restore();
}

function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  trackingPx: number
): void {
  if (Math.abs(trackingPx) < 0.05) {
    ctx.fillText(text, x, y);
    return;
  }
  let curX = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, curX, y);
    curX += ctx.measureText(ch).width + trackingPx;
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}
