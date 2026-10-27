import React, { useEffect, useRef, useState } from 'react';

export type ActivePortalMode = 'camera' | 'controller' | 'rules';

interface CircuitCityOverlayProps {
  opacity: number;
  visible: boolean;
  portalMode: ActivePortalMode;
  backHovered: boolean;
  onBackHoverChange: (hovered: boolean) => void;
  onBackClick: () => void;
  fan1Speed: number;
  fan2Speed: number;
  onFanSpeedChange: (fan1: number, fan2: number) => void;
  viewportW: number;
}

/**
 * Renders the interactive Camera Node or Admin Controller HUD over the
 * 3D Processor & Register City after the glass shatters.
 * Includes a "Pure 3D City View" toggle so the user can also watch the
 * looping blue current point animation across the processor & registers unobstructed.
 */
export const CircuitCityOverlay: React.FC<CircuitCityOverlayProps> = ({
  opacity,
  visible,
  portalMode,
  onBackHoverChange,
  onBackClick,
  fan1Speed,
  fan2Speed,
  onFanSpeedChange,
  viewportW,
}) => {
  const isCompact = viewportW < 768;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [controlSubMode, setControlSubMode] = useState<'ai' | 'manual'>('ai');
  const [personCount, setPersonCount] = useState<number>(2);
  const [hudMinimized, setHudMinimized] = useState<boolean>(false);

  // Apply the exact AI Model occupancy rules from "The Tejprakash" PDF when in AI mode
  useEffect(() => {
    if (portalMode === 'controller' && controlSubMode === 'ai') {
      if (personCount <= 0) {
        onFanSpeedChange(0, 0);
      } else if (personCount === 1) {
        onFanSpeedChange(50, 0);
      } else if (personCount === 2) {
        onFanSpeedChange(100, 0);
      } else if (personCount === 3) {
        onFanSpeedChange(50, 50);
      } else {
        onFanSpeedChange(100, 100);
      }
    }
  }, [portalMode, controlSubMode, personCount, onFanSpeedChange]);

  // Attempt live camera stream when visible in camera or controller mode
  useEffect(() => {
    if (!visible || (portalMode !== 'camera' && portalMode !== 'controller')) {
      return;
    }

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
          setCameraError(null);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCameraActive(false);
            setCameraError('Simulated Classroom Feed (Webcam permission optional)');
          }
        });
    } else {
      setCameraError('Simulated Classroom Feed');
    }

    return () => {
      cancelled = true;
      if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [visible, portalMode]);

  if (portalMode === 'rules') {
    return null;
  }

  return (
    <section
      aria-label={
        portalMode === 'camera'
          ? 'The Tejprakash Smartphone Camera Node'
          : 'The Tejprakash Admin Controller'
      }
      aria-hidden={!visible}
      data-testid="circuit-city-overlay"
      className="fixed inset-0 z-20 pointer-events-none select-text"
      style={{
        opacity,
        visibility: visible ? 'visible' : 'hidden',
      }}
    >
      {/* "← Back" hit button centered at (.219 W, .238 H) over the 3D smoked-glass sliver */}
      <button
        type="button"
        onClick={onBackClick}
        onMouseEnter={() => onBackHoverChange(true)}
        onMouseLeave={() => onBackHoverChange(false)}
        onFocus={() => onBackHoverChange(true)}
        onBlur={() => onBackHoverChange(false)}
        aria-label="Back to glass hero"
        className="fixed -translate-x-1/2 -translate-y-1/2 cursor-pointer text-transparent bg-transparent border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8] rounded px-8 py-5 whitespace-nowrap shrink-0"
        style={{
          left: isCompact ? '22vw' : '21.9vw',
          top: isCompact ? '14vh' : '23.8vh',
          fontSize: isCompact ? '13px' : '0.66vw',
          fontWeight: 500,
          pointerEvents: visible ? 'auto' : 'none',
        }}
      >
        ← Back
      </button>

      {/* Top-Right Status Badge & Toggle for Pure 3D Processor City View */}
      <div
        className="fixed top-6 right-6 flex items-center gap-3"
        style={{ pointerEvents: visible ? 'auto' : 'none' }}
      >
        <div className="px-3.5 py-2 rounded-lg bg-[#071120]/85 border border-sky-400/30 backdrop-blur-md flex items-center gap-2.5 shadow-lg">
          <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          <span className="text-[11px] font-medium tracking-wider uppercase text-sky-200">
            {portalMode === 'camera'
              ? 'Camera Node → Processor Bus Active'
              : 'Admin Controller → L298N Bus Active'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setHudMinimized((prev) => !prev)}
          className="px-3.5 py-2 rounded-lg bg-[#0b192e]/90 hover:bg-sky-500/20 border border-sky-400/40 text-sky-100 text-xs font-medium cursor-pointer transition-colors backdrop-blur-md"
        >
          {hudMinimized ? 'Show Controls' : 'Pure 3D City View'}
        </button>
      </div>

      {/* Bottom Telemetry Banner Always Showing Current Flow */}
      <div
        className="fixed bottom-5 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-xl bg-[#060f1e]/85 border border-sky-400/25 backdrop-blur-md flex flex-wrap items-center justify-center gap-6 text-xs text-sky-100/80 shadow-2xl"
        style={{ pointerEvents: visible ? 'auto' : 'none' }}
      >
        <span>
          <strong className="text-sky-300">PROCESSOR CORE:</strong> ATmega328P + AI Vision
        </span>
        <span className="text-sky-500/40">|</span>
        <span>
          <strong className="text-sky-300">FAN 1 (OUT1/OUT2 · D2/D3):</strong>{' '}
          <span className={fan1Speed > 0 ? 'text-emerald-300 font-semibold' : 'text-white/50'}>
            {fan1Speed === 0 ? 'OFF (0%)' : `${fan1Speed}% SPEED`}
          </span>
        </span>
        <span className="text-sky-500/40">|</span>
        <span>
          <strong className="text-sky-300">FAN 2 (OUT3/OUT4 · D4/D5):</strong>{' '}
          <span className={fan2Speed > 0 ? 'text-emerald-300 font-semibold' : 'text-white/50'}>
            {fan2Speed === 0 ? 'OFF (0%)' : `${fan2Speed}% SPEED`}
          </span>
        </span>
      </div>

      {/* Floating Glass Control Card (Docked on Right so the Center 3D Processor & Register City is clearly visible) */}
      {!hudMinimized && (
        <div
          className="fixed right-6 top-20 bottom-20 w-[390px] max-w-[90vw] rounded-2xl bg-[#07101f]/82 border border-sky-400/30 backdrop-blur-xl p-6 flex flex-col justify-between text-white shadow-[0_0_50px_rgba(14,165,233,0.18)] overflow-y-auto"
          style={{ pointerEvents: visible ? 'auto' : 'none' }}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-sky-300">
                {portalMode === 'camera'
                  ? 'SMARTPHONE CAMERA SENSOR'
                  : 'CONTROLLER · ADMIN UNLOCKED'}
              </span>
              <span className="text-[11px] text-sky-300/80 font-mono">12V · L298N</span>
            </div>

            <h2 className="text-lg font-semibold tracking-tight text-white mb-1">
              {portalMode === 'camera'
                ? 'Classroom Camera Feed Node'
                : 'Classroom Fan & Motor Controller'}
            </h2>
            <p className="text-xs text-sky-100/65 leading-relaxed mb-4">
              {portalMode === 'camera'
                ? 'Your device camera streams live occupancy frames into the Processor & Register City below.'
                : 'Live camera feed paired with Manual & AI Model motor control over USB Serial.'}
            </p>

            {/* Live Camera / Simulated Classroom Viewport */}
            <div className="relative w-full h-40 rounded-xl bg-[#030710] border border-sky-400/30 overflow-hidden mb-4 flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
              />
              {!cameraActive && (
                <div className="flex flex-col items-center justify-center text-center p-4">
                  <div className="w-10 h-10 rounded-lg border border-sky-400/40 bg-sky-500/10 flex items-center justify-center mb-2">
                    <span className="w-3 h-3 rounded-full bg-sky-400 animate-ping" />
                  </div>
                  <p className="text-xs font-medium text-sky-200 m-0">
                    Live Classroom Vision Stream
                  </p>
                  <p className="text-[11px] text-sky-200/55 mt-1 m-0">
                    {cameraError || 'Streaming frames to Processor Core...'}
                  </p>
                </div>
              )}
              <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-black/70 border border-sky-400/30 text-[10px] font-mono text-sky-300">
                CAM_FEED_01 · LIVE
              </div>
              {portalMode === 'controller' && controlSubMode === 'ai' && (
                <div className="absolute bottom-2.5 right-2.5 px-2.5 py-0.5 rounded bg-sky-500/25 border border-sky-400/50 text-[10px] font-mono text-sky-200">
                  DETECTED: {personCount} {personCount === 1 ? 'PERSON' : 'PERSONS'}
                </div>
              )}
            </div>

            {/* Controller Mode Tabs: Manual vs AI Model (From User PDF) */}
            {portalMode === 'controller' ? (
              <div>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#040914] border border-sky-400/20 mb-4">
                  <button
                    type="button"
                    onClick={() => setControlSubMode('manual')}
                    className={`py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      controlSubMode === 'manual'
                        ? 'bg-sky-500 text-[#030712]'
                        : 'text-sky-200/70 hover:text-white'
                    }`}
                  >
                    Manually
                  </button>
                  <button
                    type="button"
                    onClick={() => setControlSubMode('ai')}
                    className={`py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      controlSubMode === 'ai'
                        ? 'bg-sky-500 text-[#030712]'
                        : 'text-sky-200/70 hover:text-white'
                    }`}
                  >
                    AI Model
                  </button>
                </div>

                {controlSubMode === 'ai' ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-sky-100/80 font-medium">
                        Classroom Occupancy (Camera Input):
                      </span>
                      <span className="font-mono text-sky-300 font-semibold">
                        {personCount} {personCount === 1 ? 'Person' : 'People'}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[0, 1, 2, 3, 4].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => setPersonCount(cnt)}
                          className={`py-2 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${
                            personCount === cnt
                              ? 'bg-sky-500/25 border-sky-400 text-sky-200 shadow-[0_0_15px_rgba(56,189,248,0.3)]'
                              : 'bg-[#040914] border-white/10 text-white/60 hover:text-white'
                          }`}
                        >
                          {cnt === 4 ? '4+' : cnt}
                        </button>
                      ))}
                    </div>

                    <div className="p-3 rounded-xl bg-[#040914]/90 border border-sky-400/20 text-[11px] text-sky-100/75 space-y-1">
                      <div className="font-semibold text-sky-300 mb-1">
                        Active AI Predefined Parameter Rule:
                      </div>
                      {personCount === 0 && (
                        <p className="m-0">0 People → Both DC Motors OFF (0% Speed · Zero Waste).</p>
                      )}
                      {personCount === 1 && (
                        <p className="m-0">1 Person → Only Motor 1 runs at 50% speed; Motor 2 OFF.</p>
                      )}
                      {personCount === 2 && (
                        <p className="m-0">2 People → Only Motor 1 runs at 100% speed; Motor 2 OFF.</p>
                      )}
                      {personCount === 3 && (
                        <p className="m-0">3 People → Both Motor 1 &amp; Motor 2 run at 50% speed.</p>
                      )}
                      {personCount >= 4 && (
                        <p className="m-0">4+ People → Both Motor 1 &amp; Motor 2 run at 100% full speed.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Manual Fan 1 Control */}
                    <div className="p-3 rounded-xl bg-[#040914]/90 border border-sky-400/20">
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="font-semibold text-white">Fan 1 (Motor 1 · OUT1/OUT2)</span>
                        <span className="font-mono text-sky-300">{fan1Speed}%</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[
                          { label: 'OFF', val: 0 },
                          { label: 'LOW 50%', val: 50 },
                          { label: 'MID 75%', val: 75 },
                          { label: 'FULL 100%', val: 100 },
                        ].map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => onFanSpeedChange(opt.val, fan2Speed)}
                            className={`py-1.5 rounded text-[11px] font-medium border cursor-pointer ${
                              fan1Speed === opt.val
                                ? 'bg-sky-500 text-[#030712] border-sky-400 font-semibold'
                                : 'bg-[#081225] text-sky-100/70 border-sky-400/20 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Manual Fan 2 Control */}
                    <div className="p-3 rounded-xl bg-[#040914]/90 border border-sky-400/20">
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="font-semibold text-white">Fan 2 (Motor 2 · OUT3/OUT4)</span>
                        <span className="font-mono text-sky-300">{fan2Speed}%</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[
                          { label: 'OFF', val: 0 },
                          { label: 'LOW 50%', val: 50 },
                          { label: 'MID 75%', val: 75 },
                          { label: 'FULL 100%', val: 100 },
                        ].map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => onFanSpeedChange(fan1Speed, opt.val)}
                            className={`py-1.5 rounded text-[11px] font-medium border cursor-pointer ${
                              fan2Speed === opt.val
                                ? 'bg-sky-500 text-[#030712] border-sky-400 font-semibold'
                                : 'bg-[#081225] text-sky-100/70 border-sky-400/20 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-[#040914]/90 border border-sky-400/20 text-xs text-sky-100/75 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sky-300 font-semibold">Stream Status:</span>
                  <span className="text-emerald-300 font-mono">CONNECTED TO CONTROLLER</span>
                </div>
                <p className="m-0 text-[11px] leading-relaxed">
                  Blue current lines in the 3D city show live camera packets traveling into the central processor and registers.
                </p>
              </div>
            )}
          </div>

          <div className="pt-3 mt-3 border-t border-sky-400/15 flex items-center justify-between text-[11px] text-sky-200/55">
            <span>L298N Pins: D2, D3, D4, D5</span>
            <button
              type="button"
              onClick={onBackClick}
              className="text-sky-300 hover:underline cursor-pointer bg-transparent border-0 p-0 font-medium"
            >
              ← Return to Landing
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
