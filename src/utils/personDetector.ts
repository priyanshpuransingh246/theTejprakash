/**
 * Browser-side AI Person Detector using TensorFlow.js COCO-SSD.
 * Loads @tensorflow/tfjs and @tensorflow-models/coco-ssd dynamically from CDN
 * and detects people in a <video>, <img>, or <canvas> element.
 */

export interface DetectedPersonBox {
  bbox: [number, number, number, number]; // [x, y, width, height] in source pixel coords
  score: number;
}

interface CocoPrediction {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}

interface CocoSsdModel {
  detect: (
    img: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    maxNumBoxes?: number,
    minScore?: number
  ) => Promise<CocoPrediction[]>;
}

interface TfGlobal {
  setBackend?: (backendName: string) => Promise<boolean>;
  ready?: () => Promise<void>;
  getBackend?: () => string;
}

declare global {
  interface Window {
    cocoSsd?: {
      load: (config?: { base?: string }) => Promise<CocoSsdModel>;
    };
    tf?: TfGlobal;
  }
}

let modelPromise: Promise<CocoSsdModel | null> | null = null;
let internalCanvas: HTMLCanvasElement | null = null;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function getCocoSsdModel(): Promise<CocoSsdModel | null> {
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    try {
      if (!window.tf) {
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
      }
      // Force CPU backend so TensorFlow.js NEVER opens a competing WebGL context
      // that can black out the hardware <video> decoder or clash with Three.js WebGL2
      if (window.tf && typeof window.tf.setBackend === 'function') {
        try {
          await window.tf.setBackend('cpu');
          if (typeof window.tf.ready === 'function') {
            await window.tf.ready();
          }
        } catch {
          // Ignore backend switch errors
        }
      }
      if (!window.cocoSsd) {
        await loadScriptOnce(
          'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js'
        );
      }
      if (!window.cocoSsd) return null;
      const model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
      return model;
    } catch (err) {
      console.warn('COCO-SSD load warning:', err);
      modelPromise = null;
      return null;
    }
  })();

  return modelPromise;
}

export async function detectPersonsInElement(
  el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  minScore = 0.42
): Promise<{ count: number; boxes: DetectedPersonBox[] }> {
  const model = await getCocoSsdModel();
  if (!model) {
    return { count: 0, boxes: [] };
  }

  try {
    let origW = 320;
    let origH = 240;
    if (el instanceof HTMLVideoElement) {
      origW = el.videoWidth || 320;
      origH = el.videoHeight || 240;
    } else if (el instanceof HTMLImageElement) {
      origW = el.naturalWidth || el.width || 320;
      origH = el.naturalHeight || el.height || 240;
    } else if (el instanceof HTMLCanvasElement) {
      origW = el.width || 320;
      origH = el.height || 240;
    }

    if (origW <= 0 || origH <= 0) {
      return { count: 0, boxes: [] };
    }

    if (!internalCanvas) {
      internalCanvas = document.createElement('canvas');
    }
    const targetW = 240;
    const targetH = Math.max(120, Math.round((origH / origW) * targetW));
    internalCanvas.width = targetW;
    internalCanvas.height = targetH;

    const ctx = internalCanvas.getContext('2d');
    if (!ctx) {
      return { count: 0, boxes: [] };
    }
    ctx.drawImage(el, 0, 0, targetW, targetH);

    const scaleX = origW / targetW;
    const scaleY = origH / targetH;

    const predictions = await model.detect(internalCanvas, 12, minScore);
    const persons: DetectedPersonBox[] = predictions
      .filter((p) => p.class === 'person' && p.score >= minScore)
      .map((p) => ({
        bbox: [
          p.bbox[0] * scaleX,
          p.bbox[1] * scaleY,
          p.bbox[2] * scaleX,
          p.bbox[3] * scaleY,
        ],
        score: p.score,
      }));
    return {
      count: persons.length,
      boxes: persons,
    };
  } catch {
    return { count: 0, boxes: [] };
  }
}
