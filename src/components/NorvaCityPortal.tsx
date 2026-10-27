import React, { useEffect, useRef, useState } from 'react';
import {
  clamp01,
  computeNorvaScrollState,
  computeRecorderProgress,
} from '../utils/norvaScrollMath';
import { ActivePortalMode } from './CircuitCityOverlay';

const DESKTOP_CLIP_URL =
  'https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/65fdef53-5686-4659-8761-52d61bf1a4f7.mp4';
const MOBILE_CLIP_URL =
  'https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/9a30e5e9-9f03-4755-9bc1-7bcf1510aab3.mp4';
const POSTER_URL =
  'https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/33150b94-09f7-47da-a7c9-3ae76c2dd7eb.jpg';

const TEJPRAKASH_STEPS = [
  {
    num: '01',
    title: 'Smartphone camera node',
    body: 'Grant camera permission on any phone to stream live classroom video straight to the controller feed. No dedicated CCTV hardware required—just instant vision input.',
  },
  {
    num: '02',
    title: 'Admin controller & AI mode',
    body: 'Unlocked via admin password. Watch the live camera feed and switch seamlessly between human Manual control and autonomous AI Model occupancy detection.',
  },
  {
    num: '03',
    title: 'Occupancy speed rules',
    body: '1 person runs Motor 1 at 50% speed; 2 people run Motor 1 at 100%; 3 people run both Motor 1 & Motor 2 at 50%; and 4+ people run both motors at 100% speed.',
  },
  {
    num: '04',
    title: 'Arduino UNO & L298N dispatch',
    body: 'Connected via laptop USB to an Arduino UNO SMD (pins D2–D5 → IN1–IN4) driving Fan 1 (OUT1/OUT2) and Fan 2 (OUT3/OUT4) with a 12V 1A adapter and shared GND.',
  },
];

const NORVA_STEPS = [
  {
    num: '01',
    title: 'Activation, simplified',
    body: 'One call starts mobilization. Craft, headcount and start date go straight to our vetted crews. No hand-offs. No escalations. Just boots on site within minutes.',
  },
  {
    num: '02',
    title: 'Cleared to count',
    body: 'Every worker is screened before dispatch: compliance, background, certifications and fitness for duty, so the whole crew clears the gate on day one.',
  },
  {
    num: '03',
    title: 'Proven field match',
    body: 'Historical site telemetry and craft verification ensure every dispatched specialist matches the exact technical tolerances of your facility.',
  },
  {
    num: '04',
    title: 'Seamless arrival',
    body: 'Crews arrive badged, briefed and ready for shift hand-off with live supervisor tracking from dispatch hub to project gate.',
  },
];

interface NorvaCityPortalProps {
  visible: boolean;
  portalMode: ActivePortalMode;
  onBackClick: () => void;
  fan1Speed: number;
  fan2Speed: number;
  onFanSpeedChange: (fan1: number, fan2: number) => void;
}

export const NorvaCityPortal: React.FC<NorvaCityPortalProps> = ({
  visible,
  portalMode,
  onBackClick,
  fan1Speed,
  fan2Speed,
  onFanSpeedChange,
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camPreviewRef = useRef<HTMLVideoElement | null>(null);

  const [isMobileClip, setIsMobileClip] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 900 : false
  );
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [isRecMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('rec') === '1';
  });
  const [useNorvaCopy] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('brand') === 'norva';
  });

  // Loader state: fades out (.6s) 350ms after clip's first frame loads, or after 3.5s at most
  const [loaderFading, setLoaderFading] = useState<boolean>(false);
  const [loaderRemoved, setLoaderRemoved] = useState<boolean>(false);

  // Scroll-derived state
  const [scrollState, setScrollState] = useState(() => computeNorvaScrollState(0));
  const [manualStepOverride, setManualStepOverride] = useState<number | null>(null);

  // Interactive Tejprakash Controller / Camera drawer toggle inside the city view
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [controlSubMode, setControlSubMode] = useState<'ai' | 'manual'>('ai');
  const [personCount, setPersonCount] = useState<number>(2);
  const [cameraActive, setCameraActive] = useState<boolean>(false);

  // Apply AI occupancy fan rules when in AI mode
  useEffect(() => {
    if (controlSubMode === 'ai') {
      if (personCount <= 0) onFanSpeedChange(0, 0);
      else if (personCount === 1) onFanSpeedChange(50, 0);
      else if (personCount === 2) onFanSpeedChange(100, 0);
      else if (personCount === 3) onFanSpeedChange(50, 50);
      else onFanSpeedChange(100, 100);
    }
  }, [controlSubMode, personCount, onFanSpeedChange]);

  // Optional live camera stream when drawer is open
  useEffect(() => {
    if (!visible || !drawerOpen) return;
    let activeStream: MediaStream | null = null;
    let cancelled = false;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          activeStream = stream;
          setCameraActive(true);
          if (camPreviewRef.current) {
            camPreviewRef.current.srcObject = stream;
          }
        })
        .catch(() => {
          if (!cancelled) setCameraActive(false);
        });
    }
    return () => {
      cancelled = true;
      if (activeStream) activeStream.getTracks().forEach((t) => t.stop());
    };
  }, [visible, drawerOpen]);

  // Check prefers-reduced-motion & responsive video breakpoint (<= 900px)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onMq = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onMq);

    const onResize = () => {
      setIsMobileClip(window.innerWidth <= 900);
    };
    window.addEventListener('resize', onResize);
    return () => {
      mq.removeEventListener('change', onMq);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Loader lifecycle when portal becomes visible
  useEffect(() => {
    if (!visible) return;
    if (isRecMode) {
      setLoaderFading(true);
      setLoaderRemoved(true);
      return;
    }

    setLoaderFading(false);
    setLoaderRemoved(false);

    let fadeTimer = 0;
    let removeTimer = 0;
    let triggered = false;

    const triggerFadeOut = () => {
      if (triggered) return;
      triggered = true;
      setLoaderFading(true);
      removeTimer = window.setTimeout(() => {
        setLoaderRemoved(true);
      }, 620);
    };

    // Max 3.5s fallback
    const maxTimer = window.setTimeout(triggerFadeOut, 3500);

    const vid = videoRef.current;
    const onLoadedData = () => {
      fadeTimer = window.setTimeout(triggerFadeOut, 350);
    };

    if (vid) {
      if (vid.readyState >= 2) {
        onLoadedData();
      } else {
        vid.addEventListener('loadeddata', onLoadedData, { once: true });
      }
    }

    return () => {
      clearTimeout(maxTimer);
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
      if (vid) vid.removeEventListener('loadeddata', onLoadedData);
    };
  }, [visible, isRecMode]);

  // Scroll & Video scrubbing loop
  useEffect(() => {
    if (!visible) return;
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    const video = videoRef.current;
    if (!scroller || !track || !video) return;

    let targetP = 0;
    let curTime = 0;
    let targetTime = 0;
    let rafId = 0;
    let disposed = false;

    const computePFromScroll = () => {
      const scrollTop = scroller.scrollTop;
      const maxScroll = Math.max(1, track.offsetHeight - scroller.clientHeight);
      targetP = clamp01(scrollTop / maxScroll);
      setScrollState(computeNorvaScrollState(targetP));
    };

    const seekVideoIfNeeded = () => {
      if (!video || Number.isNaN(video.duration) || video.duration <= 0) return;
      if (!video.seeking && Math.abs(curTime - video.currentTime) > 1 / 60) {
        try {
          video.currentTime = Math.max(0, Math.min(video.duration - 1 / 48, curTime));
        } catch {
          // Ignore transient DOMException if media isn't ready
        }
      }
    };

    const onSeeked = () => {
      if (disposed) return;
      seekVideoIfNeeded();
    };

    video.addEventListener('seeked', onSeeked);
    scroller.addEventListener('scroll', computePFromScroll, { passive: true });

    // Expose window.__recTime(video, t) for recorder mode
    (window as any).__recTime = (vEl: HTMLVideoElement | null, tSec: number) => {
      const pRec = computeRecorderProgress(tSec);
      const maxScroll = Math.max(1, track.offsetHeight - scroller.clientHeight);
      scroller.scrollTop = pRec * maxScroll;
      targetP = pRec;
      setScrollState(computeNorvaScrollState(pRec));
      const dur = (vEl && vEl.duration) || video.duration || 5.04;
      const clipT = pRec * Math.max(0, dur - 1 / 48);
      curTime = clipT;
      targetTime = clipT;
      if (video && !Number.isNaN(video.duration) && video.duration > 0) {
        video.currentTime = clipT;
      }
      return clipT;
    };

    const recStartSec = performance.now() * 0.001;

    const tick = () => {
      if (disposed) return;

      if (isRecMode) {
        const elapsed = performance.now() * 0.001 - recStartSec;
        const pRec = computeRecorderProgress(elapsed);
        const maxScroll = Math.max(1, track.offsetHeight - scroller.clientHeight);
        scroller.scrollTop = pRec * maxScroll;
        targetP = pRec;
        setScrollState(computeNorvaScrollState(pRec));
      }

      const dur = video.duration && !Number.isNaN(video.duration) ? video.duration : 5.04;
      targetTime = targetP * Math.max(0, dur - 1 / 48);

      if (reducedMotion || isRecMode) {
        curTime = targetTime;
      } else {
        curTime += (targetTime - curTime) * 0.2;
      }

      seekVideoIfNeeded();
      rafId = requestAnimationFrame(tick);
    };

    computePFromScroll();
    rafId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      video.removeEventListener('seeked', onSeeked);
      scroller.removeEventListener('scroll', computePFromScroll);
    };
  }, [visible, reducedMotion, isRecMode]);

  if (!visible || portalMode === 'rules') {
    return null;
  }

  const steps = useNorvaCopy ? NORVA_STEPS : TEJPRAKASH_STEPS;
  const effectiveActiveStep =
    manualStepOverride !== null ? manualStepOverride : scrollState.activeStepIndex;

  return (
    <div
      ref={scrollerRef}
      data-testid="norva-city-portal"
      className="norva-root fixed inset-0 z-20 overflow-y-auto overflow-x-hidden bg-[#0f1626] text-[#f4f6fa] select-text"
    >
      {/* Full-Screen Night Loader with Two Dotted Ellipses & Spinning 6-Square Cyan + Lime Chevron Mark */}
      {!loaderRemoved && !isRecMode && (
        <div
          data-testid="norva-loader"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1626] pointer-events-none"
          style={{
            opacity: loaderFading ? 0 : 1,
            transition: reducedMotion ? 'none' : 'opacity 0.6s ease',
          }}
        >
          <div className="relative flex items-center justify-center w-[320px] h-[220px]">
            {/* Wide dotted ellipse & circular dotted ellipse */}
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 320 220"
              fill="none"
            >
              <ellipse
                cx="160"
                cy="110"
                rx="145"
                ry="68"
                stroke="rgba(244, 246, 250, 0.22)"
                strokeWidth="1.2"
                strokeDasharray="3 6"
              />
              <ellipse
                cx="160"
                cy="110"
                rx="84"
                ry="84"
                stroke="rgba(63, 216, 255, 0.28)"
                strokeWidth="1.2"
                strokeDasharray="2.5 5.5"
              />
            </svg>

            {/* Spinning Mark: Six Cyan Squares in a Ring + Lime Chevron */}
            <div className={reducedMotion ? '' : 'norva-loader-spin'}>
              <svg width="76" height="76" viewBox="0 0 76 76" fill="none">
                {[0, 60, 120, 180, 240, 300].map((deg) => {
                  const rad = (deg * Math.PI) / 180;
                  const cx = 38 + Math.cos(rad) * 24;
                  const cy = 38 + Math.sin(rad) * 24;
                  return (
                    <rect
                      key={deg}
                      x={cx - 3.5}
                      y={cy - 3.5}
                      width="7"
                      height="7"
                      rx="1.2"
                      fill="#3fd8ff"
                    />
                  );
                })}
                <path
                  d="M31 42L38 33L45 42"
                  stroke="#c6ff2e"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* 420vh Scroll Track holding Sticky 100vh Video Scene */}
      <div ref={trackRef} className="relative w-full h-[420vh]">
        <div className="sticky top-0 left-0 w-full h-screen overflow-hidden bg-[#0f1626]">
          <video
            ref={videoRef}
            src={isMobileClip ? MOBILE_CLIP_URL : DESKTOP_CLIP_URL}
            poster={POSTER_URL}
            muted
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            className="w-full h-full object-cover pointer-events-none"
          />

          {/* Light shade over the clip: navy #0f1626 at 55% fading out by 34% from top, and 50% fading out by 30% from bottom */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'linear-gradient(180deg, rgba(15,22,38,0.55) 0%, rgba(15,22,38,0) 34%, rgba(15,22,38,0) 70%, rgba(15,22,38,0.50) 100%)',
            }}
          />
        </div>
      </div>

      {/* Fixed Top Navigation (58u tall, three columns) */}
      <header className="norva-nav fixed top-0 left-0 right-0 z-30 flex items-center justify-between">
        {/* Left links (hidden on phones <= 760px) */}
        <div className="norva-nav-left flex items-center">
          <button
            type="button"
            onClick={onBackClick}
            className="norva-label text-[#f4f6fa]/72 hover:text-[#f4f6fa] bg-transparent border-0 cursor-pointer p-0 transition-colors"
          >
            ← GLASS HERO
          </button>
          <button
            type="button"
            onClick={() => {
              if (scrollerRef.current && trackRef.current) {
                const maxScroll =
                  trackRef.current.offsetHeight - scrollerRef.current.clientHeight;
                scrollerRef.current.scrollTo({ top: maxScroll * 0.35, behavior: 'smooth' });
              }
            }}
            className="norva-label text-[#f4f6fa]/72 hover:text-[#f4f6fa] bg-transparent border-0 cursor-pointer p-0 transition-colors"
          >
            {useNorvaCopy ? 'OUR INDUSTRIES' : 'CAMERA NODE'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (scrollerRef.current && trackRef.current) {
                const maxScroll =
                  trackRef.current.offsetHeight - scrollerRef.current.clientHeight;
                scrollerRef.current.scrollTo({ top: maxScroll * 0.85, behavior: 'smooth' });
              }
            }}
            className="norva-label text-[#f4f6fa]/72 hover:text-[#f4f6fa] bg-transparent border-0 cursor-pointer p-0 transition-colors"
          >
            {useNorvaCopy ? 'OUR MISSION' : 'AI RULES'}
          </button>
        </div>

        {/* Centre Wordmark (700, 19u, .06em tracking) */}
        <div className="norva-wordmark font-bold text-[#f4f6fa] select-none">
          {useNorvaCopy ? 'NORVA' : 'TEJPRAKASH'}
        </div>

        {/* Right: Grey pill and Lime pill (40u tall, fully rounded, lift 1px on hover) */}
        <div className="norva-nav-right flex items-center">
          <button
            type="button"
            onClick={onBackClick}
            className="norva-pill norva-pill-grey norva-label text-[#f4f6fa] cursor-pointer border-0"
          >
            {useNorvaCopy ? 'APPLY' : 'BACK'}
          </button>
          <button
            type="button"
            data-testid="btn-toggle-controller-drawer"
            onClick={() => setDrawerOpen((prev) => !prev)}
            className="norva-pill norva-pill-lime norva-label text-[#0f1626] font-semibold cursor-pointer border-0"
          >
            {drawerOpen
              ? 'CLOSE PANEL'
              : useNorvaCopy
              ? 'REQUEST CREWS'
              : portalMode === 'camera'
              ? 'CAMERA FEED'
              : 'CONTROLLER'}
          </button>
        </div>
      </header>

      {/* Fixed Hero Copy (centred, 92u from top, inside perspective: 900u stage) */}
      <div
        className="norva-hero-stage fixed left-0 right-0 z-25 flex flex-col items-center text-center pointer-events-none"
        style={{
          opacity: scrollState.headlineOpacity,
          visibility: scrollState.headlineOpacity <= 0.005 ? 'hidden' : 'visible',
        }}
      >
        <div
          data-testid="norva-headline-block"
          className="origin-bottom will-change-transform"
          style={{
            transform: scrollState.headlineTransform,
          }}
        >
          {useNorvaCopy ? (
            <>
              <h1 className="norva-headline font-semibold text-[#f4f6fa] m-0">
                The New Standard
                <br />
                in Staffing
              </h1>
              <p className="norva-subline text-[#f4f6fa]/72 m-0">
                AI driven speed. Expert curation.
                <span className="norva-br">
                  <br />
                </span>{' '}
                We mobilize verified crews to protect your schedule and
                <span className="norva-br">
                  <br />
                </span>{' '}
                your bottom line in high-consequence environments.
              </p>
            </>
          ) : (
            <>
              <h1 className="norva-headline font-semibold text-[#f4f6fa] m-0">
                The New Standard
                <br />
                in Smart Power
              </h1>
              <p className="norva-subline text-[#f4f6fa]/72 m-0">
                AI driven vision. Zero electrical waste.
                <span className="norva-br">
                  <br />
                </span>{' '}
                We connect smartphone classroom cameras to automated fan speed control
                <span className="norva-br">
                  <br />
                </span>{' '}
                powered by Arduino UNO SMD and dual L298N motor drivers.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Scroll Cue: centred 36u from bottom, with 1px underline */}
      <div
        data-testid="norva-scroll-cue"
        className="norva-scroll-cue fixed left-1/2 -translate-x-1/2 z-25 flex flex-col items-center pointer-events-none"
        style={{
          opacity: scrollState.scrollCueOpacity,
          visibility: scrollState.scrollCueOpacity <= 0.005 ? 'hidden' : 'visible',
        }}
      >
        <span className="norva-label text-[#f4f6fa]/72 whitespace-nowrap">
          SCROLL TO DISCOVER OUR PROCESS
        </span>
        <div className="w-full h-[1px] bg-white/15 mt-1.5 overflow-hidden">
          <div
            className="w-full h-full bg-[#f4f6fa] origin-left"
            style={{
              transform: `scaleX(${scrollState.scrollCueUnderlineScale.toFixed(4)})`,
            }}
          />
        </div>
      </div>

      {/* Process List (fixed, bottom left at 36u / 28u, 430u wide): four rows */}
      <aside
        aria-label="Four-step process"
        data-testid="norva-process-list"
        className="norva-process-list fixed z-30"
        style={{
          opacity: scrollState.processListOpacity,
          transform: `translateY(${scrollState.processListTranslateY.toFixed(2)}px)`,
          pointerEvents: scrollState.processListOpacity > 0.05 ? 'auto' : 'none',
        }}
      >
        {steps.map((step, idx) => {
          const isActive = effectiveActiveStep === idx;
          return (
            <div
              key={step.num}
              onClick={() =>
                setManualStepOverride((prev) => (prev === idx ? null : idx))
              }
              className="norva-process-row border-b border-white/22 last:border-b-0 cursor-pointer"
            >
              <div className="flex items-center">
                <div
                  className={`norva-step-num flex items-center justify-center font-medium transition-all duration-300 ${
                    isActive
                      ? 'bg-[#f4f6fa] text-[#0f1626] rounded-[6px] font-semibold'
                      : 'text-[#f4f6fa]/72'
                  }`}
                >
                  {step.num}
                </div>
                <div
                  className={`norva-step-title transition-all duration-300 ${
                    isActive
                      ? 'norva-step-title-active text-[#f4f6fa] font-medium'
                      : 'text-[#f4f6fa]/72 font-medium'
                  }`}
                >
                  {step.title}
                </div>
              </div>

              {/* Expandable body paragraph (grid-template-rows: 0fr -> 1fr, .45s) with hairline at its left */}
              <div
                className="grid transition-[grid-template-rows] duration-[450ms] ease-out"
                style={{
                  gridTemplateRows: isActive ? '1fr' : '0fr',
                }}
              >
                <div className="overflow-hidden">
                  <div className="norva-step-body-wrap border-l border-white/22">
                    <p className="norva-step-body text-[#f4f6fa]/72 m-0">
                      {step.body}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </aside>

      {/* Collapsible Tejprakash Camera & L298N Fan Controller Drawer (Top-Right) */}
      {drawerOpen && (
        <div
          data-testid="tejprakash-city-drawer"
          className="fixed right-6 top-20 z-40 w-[360px] max-w-[92vw] rounded-2xl bg-[#0f1626]/92 border border-white/22 backdrop-blur-xl p-5 text-[#f4f6fa] shadow-2xl"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[#3fd8ff]">
              {portalMode === 'camera'
                ? 'TEJPRAKASH · CAMERA NODE'
                : 'TEJPRAKASH · ADMIN CONTROLLER'}
            </span>
            <span className="text-[11px] font-mono text-[#c6ff2e]">L298N · USB</span>
          </div>

          {/* Live Camera Feed Box */}
          <div className="relative w-full h-32 rounded-xl bg-[#080d18] border border-white/15 overflow-hidden mb-3 flex items-center justify-center">
            <video
              ref={camPreviewRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
            />
            {!cameraActive && (
              <div className="text-center px-3">
                <p className="text-xs font-medium text-[#f4f6fa]/85 m-0">
                  Live Classroom Camera Feed
                </p>
                <p className="text-[11px] text-[#f4f6fa]/50 mt-1 m-0">
                  Detected: {personCount} {personCount === 1 ? 'Person' : 'People'} in frame
                </p>
              </div>
            )}
          </div>

          {/* Manual vs AI Model Toggle */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#182136] mb-3">
            <button
              type="button"
              onClick={() => setControlSubMode('manual')}
              className={`py-1.5 rounded text-xs font-semibold cursor-pointer border-0 ${
                controlSubMode === 'manual'
                  ? 'bg-[#c6ff2e] text-[#0f1626]'
                  : 'bg-transparent text-[#f4f6fa]/70'
              }`}
            >
              Manually
            </button>
            <button
              type="button"
              onClick={() => setControlSubMode('ai')}
              className={`py-1.5 rounded text-xs font-semibold cursor-pointer border-0 ${
                controlSubMode === 'ai'
                  ? 'bg-[#c6ff2e] text-[#0f1626]'
                  : 'bg-transparent text-[#f4f6fa]/70'
              }`}
            >
              AI Model
            </button>
          </div>

          {controlSubMode === 'ai' ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#f4f6fa]/72">Classroom Headcount:</span>
                <span className="font-semibold text-[#c6ff2e]">
                  {personCount} {personCount === 1 ? 'Person' : 'People'}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 1, 2, 3, 4].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setPersonCount(cnt)}
                    className={`py-1.5 rounded text-xs font-semibold cursor-pointer border ${
                      personCount === cnt
                        ? 'bg-[#3fd8ff]/20 border-[#3fd8ff] text-[#3fd8ff]'
                        : 'bg-[#182136] border-white/10 text-[#f4f6fa]/60'
                    }`}
                  >
                    {cnt === 4 ? '4+' : cnt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span>Fan 1 (OUT1/OUT2):</span>
                <div className="flex gap-1">
                  {[0, 50, 100].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => onFanSpeedChange(v, fan2Speed)}
                      className={`px-2 py-1 rounded text-[11px] cursor-pointer border-0 ${
                        fan1Speed === v
                          ? 'bg-[#c6ff2e] text-[#0f1626] font-semibold'
                          : 'bg-[#182136] text-[#f4f6fa]/70'
                      }`}
                    >
                      {v}%
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>Fan 2 (OUT3/OUT4):</span>
                <div className="flex gap-1">
                  {[0, 50, 100].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => onFanSpeedChange(fan1Speed, v)}
                      className={`px-2 py-1 rounded text-[11px] cursor-pointer border-0 ${
                        fan2Speed === v
                          ? 'bg-[#c6ff2e] text-[#0f1626] font-semibold'
                          : 'bg-[#182136] text-[#f4f6fa]/70'
                      }`}
                    >
                      {v}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mt-3 pt-2.5 border-t border-white/15 flex items-center justify-between text-[11px] text-[#f4f6fa]/70">
            <span>
              M1: <strong className="text-[#c6ff2e]">{fan1Speed}%</strong> · M2:{' '}
              <strong className="text-[#c6ff2e]">{fan2Speed}%</strong>
            </span>
            <button
              type="button"
              onClick={onBackClick}
              className="text-[#3fd8ff] hover:underline bg-transparent border-0 cursor-pointer p-0"
            >
              ← Glass Landing
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
