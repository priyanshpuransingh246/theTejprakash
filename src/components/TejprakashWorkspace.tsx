import React, { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import {
  ARDUINO_INO_CODE,
  computeAiFanDecision,
  ControlMode,
  formatArduinoCommand,
} from '../utils/tejprakashLogic';
import {
  DetectedPersonBox,
  detectPersonsInElement,
  getCocoSsdModel,
} from '../utils/personDetector';

interface WebSerialPort {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  writable?: {
    getWriter: () => {
      write: (data: Uint8Array) => Promise<void>;
      releaseLock: () => void;
    };
  };
  readable?: {
    getReader: () => {
      read: () => Promise<{ value?: Uint8Array; done: boolean }>;
      releaseLock: () => void;
    };
  };
}

export interface TejprakashWorkspaceProps {
  visible: boolean;
  initialRole: 'camera' | 'controller';
  onBackToHero: () => void;
  onRequestControllerLogin: () => void;
  fan1Speed: number;
  fan2Speed: number;
  onFanSpeedChange: (fan1: number, fan2: number) => void;
}

const DEFAULT_ROOM_ID = 'TEJ-108';

export const TejprakashWorkspace: React.FC<TejprakashWorkspaceProps> = ({
  visible,
  initialRole,
  onBackToHero,
  onRequestControllerLogin,
  fan1Speed,
  fan2Speed,
  onFanSpeedChange,
}) => {
  const [role, setRole] = useState<'camera' | 'controller'>(initialRole);
  const [roomId] = useState<string>(DEFAULT_ROOM_ID);

  // Controller mode: 'manual' vs 'ai' (as required by DOCX)
  const [controlMode, setControlMode] = useState<ControlMode>('ai');

  // Camera state
  const [localCameraActive, setLocalCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Remote camera frame received from Smartphone Camera Node
  const [remoteFrameUrl, setRemoteFrameUrl] = useState<string | null>(null);
  const [remoteCameraOnline, setRemoteCameraOnline] = useState(false);
  const [remoteStreamActive, setRemoteStreamActive] = useState(false);

  // AI Person Detection State
  const [aiModelLoaded, setAiModelLoaded] = useState(false);
  const [aiModelLoading, setAiModelLoading] = useState(false);
  const [rawDetectedCount, setRawDetectedCount] = useState(0);
  const [stablePersonCount, setStablePersonCount] = useState(0);
  const [detectedBoxes, setDetectedBoxes] = useState<DetectedPersonBox[]>([]);
  const [aiCountOverride, setAiCountOverride] = useState<number | null>(null);

  // Arduino Web Serial State
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialStatus, setSerialStatus] = useState<string>('USB Not Paired');
  const [lastTxCommand, setLastTxCommand] = useState<string>('F1:0,F2:0');
  const [lastArduinoReply, setLastArduinoReply] = useState<string>('—');
  const [showArduinoCodeModal, setShowArduinoCodeModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Refs for media, canvas, WebSocket, PeerJS, and Serial
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteImgRef = useRef<HTMLImageElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const peerConnRef = useRef<DataConnection | null>(null);
  const mediaCallRef = useRef<MediaConnection | null>(null);

  const serialPortRef = useRef<WebSerialPort | null>(null);
  const lastSentCmdRef = useRef<string>('');
  const lastSentTimeRef = useRef<number>(0);

  // Sync role when initialRole changes
  useEffect(() => {
    setRole(initialRole);
  }, [initialRole]);

  // Preload COCO-SSD AI person detection model when workspace becomes visible
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setAiModelLoading(true);
    getCocoSsdModel()
      .then((model) => {
        if (!cancelled) {
          setAiModelLoaded(Boolean(model));
          setAiModelLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setAiModelLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Write command to Arduino UNO over Web Serial
  const sendCommandToArduino = useCallback(async (f1: number, f2: number, force = false) => {
    const cmd = formatArduinoCommand(f1, f2);
    const trimmed = cmd.trim();
    setLastTxCommand(trimmed);

    const now = performance.now();
    if (!force && cmd === lastSentCmdRef.current && now - lastSentTimeRef.current < 1800) {
      return;
    }
    lastSentCmdRef.current = cmd;
    lastSentTimeRef.current = now;

    const port = serialPortRef.current;
    if (!port || !port.writable) return;

    try {
      const writer = port.writable.getWriter();
      await writer.write(new TextEncoder().encode(cmd));
      writer.releaseLock();
    } catch (err) {
      console.warn('Serial write warning:', err);
    }
  }, []);

  // Connect to Arduino UNO via Web Serial API (9600 baud)
  const handleConnectSerial = async () => {
    const nav = navigator as unknown as {
      serial?: { requestPort: () => Promise<WebSerialPort> };
    };
    if (!nav.serial) {
      setSerialStatus('Use Chrome or Edge on Laptop for USB Web Serial');
      return;
    }

    try {
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 9600 });
      serialPortRef.current = port;
      setSerialConnected(true);
      setSerialStatus('Arduino UNO Connected (9600 baud)');

      // Start reading Arduino responses in background
      if (port.readable) {
        (async () => {
          try {
            const reader = port.readable!.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) {
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split(/\r?\n/);
                buf = lines.pop() || '';
                for (const line of lines) {
                  if (line.trim()) {
                    setLastArduinoReply(line.trim());
                  }
                }
              }
            }
            reader.releaseLock();
          } catch {
            // Port closed
          }
        })();
      }

      // Send initial state after Arduino boot delay (1.6s)
      window.setTimeout(() => {
        sendCommandToArduino(fan1Speed, fan2Speed, true);
      }, 1600);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection cancelled';
      setSerialStatus(`USB: ${msg}`);
    }
  };

  // Start or stop local camera (used immediately in Camera role, or optionally in Controller role)
  const startLocalCamera = useCallback(
    async (preferredFacing: 'environment' | 'user' = facingMode) => {
      setCameraError(null);
      try {
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera API not available in this browser context');
        }
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: preferredFacing },
              width: { ideal: 640 },
              height: { ideal: 480 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        mediaStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          await localVideoRef.current.play().catch(() => {});
        }
        setLocalCameraActive(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Camera permission denied';
        setCameraError(msg);
        setLocalCameraActive(false);
      }
    },
    [facingMode]
  );

  const stopLocalCamera = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setLocalCameraActive(false);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && role === 'camera') {
      wsRef.current.send(JSON.stringify({ type: 'camera:stopped', roomId }));
    }
  }, [role, roomId]);

  // Automatically start camera when entering as Smartphone Camera Node
  useEffect(() => {
    if (!visible) return;
    if (role === 'camera' && !localCameraActive) {
      startLocalCamera(facingMode);
    }
  }, [visible, role, localCameraActive, facingMode, startLocalCamera]);

  // Clean up camera when leaving workspace
  useEffect(() => {
    if (!visible && localCameraActive) {
      stopLocalCamera();
    }
  }, [visible, localCameraActive, stopLocalCamera]);

  // Set up WebSocket + BroadcastChannel + PeerJS real-time link between Smartphone Camera and Laptop Controller
  useEffect(() => {
    if (!visible) return;

    // 1. BroadcastChannel (instant sync across tabs on the same device)
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(`tejprakash_${roomId}`);
      bcRef.current = bc;
      bc.onmessage = (ev) => {
        const data = ev.data;
        if (!data) return;
        if (data.type === 'camera:frame' && role === 'controller') {
          setRemoteFrameUrl(data.frameDataUrl);
          setRemoteCameraOnline(true);
          if (typeof data.personCount === 'number') {
            setRawDetectedCount(data.personCount);
          }
          if (Array.isArray(data.boxes)) {
            setDetectedBoxes(data.boxes);
          }
        } else if (data.type === 'controller:update' && role === 'camera') {
          if (typeof data.fan1Speed === 'number' && typeof data.fan2Speed === 'number') {
            onFanSpeedChange(data.fan1Speed, data.fan2Speed);
          }
        }
      };
    }

    // 2. WebSocket link to server.ts (/ws)
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let unmounted = false;

    const connectWs = () => {
      if (unmounted) return;
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          ws?.send(
            JSON.stringify({
              type: 'room:join',
              roomId,
              role,
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'room:init' && msg.state) {
              if (role === 'controller' && msg.state.latestFrameDataUrl) {
                setRemoteFrameUrl(msg.state.latestFrameDataUrl);
                setRemoteCameraOnline(Boolean(msg.state.cameraActive));
                setRawDetectedCount(msg.state.personCount || 0);
                setDetectedBoxes(msg.state.boxes || []);
              }
            } else if (msg.type === 'camera:frame' && role === 'controller') {
              if (msg.frameDataUrl) {
                setRemoteFrameUrl(msg.frameDataUrl);
              }
              setRemoteCameraOnline(true);
              if (typeof msg.personCount === 'number') {
                setRawDetectedCount(msg.personCount);
              }
              if (Array.isArray(msg.boxes)) {
                setDetectedBoxes(msg.boxes);
              }
            } else if (msg.type === 'camera:stopped' && role === 'controller') {
              setRemoteCameraOnline(false);
            } else if (msg.type === 'presence:update' && role === 'controller') {
              setRemoteCameraOnline(Boolean(msg.cameraActive));
            } else if (msg.type === 'controller:update' && role === 'camera') {
              if (typeof msg.fan1Speed === 'number' && typeof msg.fan2Speed === 'number') {
                onFanSpeedChange(msg.fan1Speed, msg.fan2Speed);
              }
            }
          } catch {
            // Ignore malformed JSON
          }
        };

        ws.onclose = () => {
          if (!unmounted) {
            reconnectTimer = window.setTimeout(connectWs, 2000);
          }
        };
      } catch {
        // Fallback to PeerJS / HTTP
      }
    };

    connectWs();

    // 3. PeerJS WebRTC fallback (allows Smartphone -> Laptop streaming even on static GitHub Pages!)
    const peerId =
      role === 'controller'
        ? `tejprakash-ctrl-${roomId.toLowerCase()}`
        : `tejprakash-cam-${roomId.toLowerCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    let peer: Peer | null = null;
    let peerRetryTimer: number | null = null;
    try {
      peer = new Peer(peerId);
      peerRef.current = peer;

      const tryConnectPeerToController = () => {
        if (unmounted || role !== 'camera' || !peer || peer.disconnected || peer.destroyed) return;
        const targetCtrlId = `tejprakash-ctrl-${roomId.toLowerCase()}`;
        if (!peerConnRef.current || !peerConnRef.current.open) {
          try {
            const conn = peer.connect(targetCtrlId, { reliable: false });
            peerConnRef.current = conn;
          } catch {
            // Retry on next tick
          }
        }
        if (mediaStreamRef.current && (!mediaCallRef.current || !mediaCallRef.current.open)) {
          try {
            mediaCallRef.current = peer.call(targetCtrlId, mediaStreamRef.current);
          } catch {
            // Retry on next tick
          }
        }
      };

      peer.on('open', () => {
        if (role === 'camera') {
          tryConnectPeerToController();
          peerRetryTimer = window.setInterval(tryConnectPeerToController, 3000);
        }
      });

      peer.on('connection', (conn) => {
        peerConnRef.current = conn;
        conn.on('data', (raw: unknown) => {
          const data = raw as {
            type?: string;
            frameDataUrl?: string;
            personCount?: number;
            boxes?: DetectedPersonBox[];
          };
          if (data && data.type === 'camera:frame' && role === 'controller') {
            if (data.frameDataUrl) setRemoteFrameUrl(data.frameDataUrl);
            setRemoteCameraOnline(true);
            if (typeof data.personCount === 'number') setRawDetectedCount(data.personCount);
            if (Array.isArray(data.boxes)) setDetectedBoxes(data.boxes);
          }
        });
      });

      peer.on('call', (call) => {
        call.answer();
        call.on('stream', (remoteStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            remoteVideoRef.current.play().catch(() => {});
            setRemoteStreamActive(true);
            setRemoteCameraOnline(true);
          }
        });
      });
    } catch {
      // PeerJS optional fallback
    }

    return () => {
      unmounted = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (peerRetryTimer !== null) window.clearInterval(peerRetryTimer);
      ws?.close();
      bc?.close();
      peer?.destroy();
    };
  }, [visible, role, roomId, onFanSpeedChange]);

  // When camera stream starts in Camera role, also call Controller via PeerJS if available
  useEffect(() => {
    if (
      role === 'camera' &&
      localCameraActive &&
      mediaStreamRef.current &&
      peerRef.current &&
      !peerRef.current.disconnected
    ) {
      try {
        const targetCtrlId = `tejprakash-ctrl-${roomId.toLowerCase()}`;
        mediaCallRef.current = peerRef.current.call(targetCtrlId, mediaStreamRef.current);
        if (!peerConnRef.current || !peerConnRef.current.open) {
          peerConnRef.current = peerRef.current.connect(targetCtrlId, { reliable: false });
        }
      } catch {
        // Ignore
      }
    }
  }, [role, localCameraActive, roomId]);

  // Continuous AI Person Detection + Frame Broadcast Loop (runs at ~5 fps)
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let timerId: number | null = null;

    const stepLoop = async () => {
      if (!active) return;

      const videoEl = localCameraActive
        ? localVideoRef.current
        : remoteStreamActive
        ? remoteVideoRef.current
        : null;

      if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        // 1. Run AI Person Detection on active video
        const { count, boxes } = await detectPersonsInElement(videoEl, 0.42);
        if (!active) return;
        setRawDetectedCount(count);
        setDetectedBoxes(boxes);

        // 2. If we are the Smartphone Camera Node, compress & broadcast frame + person count to Controller
        if (role === 'camera') {
          let canvas = captureCanvasRef.current;
          if (!canvas) {
            canvas = document.createElement('canvas');
            captureCanvasRef.current = canvas;
          }
          const targetW = 480;
          const targetH = Math.round((videoEl.videoHeight / videoEl.videoWidth) * targetW) || 360;
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(videoEl, 0, 0, targetW, targetH);
            const scaleX = targetW / videoEl.videoWidth;
            const scaleY = targetH / videoEl.videoHeight;
            const scaledBoxes: DetectedPersonBox[] = boxes.map((b) => ({
              bbox: [
                Math.round(b.bbox[0] * scaleX),
                Math.round(b.bbox[1] * scaleY),
                Math.round(b.bbox[2] * scaleX),
                Math.round(b.bbox[3] * scaleY),
              ],
              score: b.score,
            }));
            const frameDataUrl = canvas.toDataURL('image/jpeg', 0.58);
            const packet = {
              type: 'camera:frame',
              roomId,
              frameDataUrl,
              personCount: count,
              boxes: scaledBoxes,
            };

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify(packet));
            }
            if (bcRef.current) {
              bcRef.current.postMessage(packet);
            }
            if (peerConnRef.current && peerConnRef.current.open) {
              peerConnRef.current.send(packet);
            }
          }
        }
      } else if (
        role === 'controller' &&
        !localCameraActive &&
        !remoteStreamActive &&
        remoteFrameUrl &&
        remoteImgRef.current &&
        remoteImgRef.current.complete &&
        remoteImgRef.current.naturalWidth > 0
      ) {
        // Also run local detection on incoming remote image if needed
        const { count, boxes } = await detectPersonsInElement(remoteImgRef.current, 0.42);
        if (active && count >= 0) {
          setRawDetectedCount(count);
          setDetectedBoxes(boxes);
        }
      }

      if (active) {
        timerId = window.setTimeout(stepLoop, 220);
      }
    };

    timerId = window.setTimeout(stepLoop, 300);
    return () => {
      active = false;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [visible, localCameraActive, remoteStreamActive, remoteFrameUrl, role, roomId]);

  // Draw AI person detection bounding boxes onto overlayCanvasRef
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let srcW = 640;
    let srcH = 480;
    if (localCameraActive && localVideoRef.current && localVideoRef.current.videoWidth > 0) {
      srcW = localVideoRef.current.videoWidth;
      srcH = localVideoRef.current.videoHeight;
    } else if (remoteStreamActive && remoteVideoRef.current && remoteVideoRef.current.videoWidth > 0) {
      srcW = remoteVideoRef.current.videoWidth;
      srcH = remoteVideoRef.current.videoHeight;
    } else if (remoteImgRef.current && remoteImgRef.current.naturalWidth > 0) {
      srcW = remoteImgRef.current.naturalWidth;
      srcH = remoteImgRef.current.naturalHeight;
    }

    canvas.width = srcW;
    canvas.height = srcH;
    ctx.clearRect(0, 0, srcW, srcH);

    for (const item of detectedBoxes) {
      const [x, y, w, h] = item.bbox;
      ctx.strokeStyle = '#36d67e';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);

      const label = `PERSON ${Math.round(item.score * 100)}%`;
      ctx.font = '600 13px Inter, sans-serif';
      const textW = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.92)';
      ctx.fillRect(x, Math.max(0, y - 24), textW, 24);
      ctx.fillStyle = '#04130a';
      ctx.fillText(label, x + 6, Math.max(16, y - 7));
    }
  }, [detectedBoxes, localCameraActive, remoteStreamActive, remoteFrameUrl]);

  // Stabilize person count over 1.1s so a single-frame camera flicker never jerks the motors
  useEffect(() => {
    if (aiCountOverride !== null) {
      setStablePersonCount(aiCountOverride);
      return;
    }
    const timer = window.setTimeout(() => {
      setStablePersonCount(rawDetectedCount);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [rawDetectedCount, aiCountOverride]);

  // Apply AI Mode rules automatically when controlMode === 'ai'
  const effectivePersonCount = aiCountOverride !== null ? aiCountOverride : stablePersonCount;
  const currentAiDecision = computeAiFanDecision(effectivePersonCount);

  useEffect(() => {
    if (!visible || role !== 'controller') return;
    if (controlMode === 'ai') {
      if (
        fan1Speed !== currentAiDecision.fan1Speed ||
        fan2Speed !== currentAiDecision.fan2Speed
      ) {
        onFanSpeedChange(currentAiDecision.fan1Speed, currentAiDecision.fan2Speed);
      }
      sendCommandToArduino(currentAiDecision.fan1Speed, currentAiDecision.fan2Speed);
    }
  }, [
    visible,
    role,
    controlMode,
    currentAiDecision.fan1Speed,
    currentAiDecision.fan2Speed,
    fan1Speed,
    fan2Speed,
    onFanSpeedChange,
    sendCommandToArduino,
  ]);

  // Broadcast controller fan changes to Smartphone Camera node & Arduino
  const applyManualFanChange = (nextFan1: number, nextFan2: number) => {
    setControlMode('manual');
    onFanSpeedChange(nextFan1, nextFan2);
    sendCommandToArduino(nextFan1, nextFan2, true);

    const payload = {
      type: 'controller:update',
      roomId,
      fan1Speed: nextFan1,
      fan2Speed: nextFan2,
      controlMode: 'manual',
    };
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
    if (bcRef.current) {
      bcRef.current.postMessage(payload);
    }
  };

  // Periodic 2.5s serial keepalive when Arduino is connected
  useEffect(() => {
    if (!serialConnected) return;
    const id = window.setInterval(() => {
      sendCommandToArduino(fan1Speed, fan2Speed, false);
    }, 2500);
    return () => window.clearInterval(id);
  }, [serialConnected, fan1Speed, fan2Speed, sendCommandToArduino]);

  if (!visible) return null;

  const hasAnyVideoFeed = localCameraActive || remoteStreamActive || Boolean(remoteFrameUrl);

  return (
    <div
      data-testid="tejprakash-workspace"
      className="fixed inset-0 z-30 bg-[#07090e] text-[#f3f5f8] overflow-y-auto select-text font-sans"
    >
      {/* Top Plain Header Bar */}
      <header className="sticky top-0 z-20 bg-[#0b0e17]/95 backdrop-blur-md border-b border-white/10 px-4 md:px-8 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="workspace-back-btn"
            onClick={onBackToHero}
            className="px-3.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 border border-white/15 text-xs font-medium text-white cursor-pointer transition-colors"
          >
            ← Back to Glass Hero
          </button>

          <div className="h-4 w-[1px] bg-white/15 hidden sm:block" />

          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-white">
                The Tejprakash
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                {role === 'camera' ? 'Smartphone Camera Node' : 'Admin Controller'}
              </span>
            </div>
            <p className="text-[11px] text-white/50 m-0 hidden sm:block">
              Smart Classroom Energy Conservation · Arduino UNO SMD + L298N Dual Fan Control
            </p>
          </div>
        </div>

        {/* Right Controls: Role Switcher + Arduino Pairing + Arduino Code */}
        <div className="flex flex-wrap items-center gap-2.5">
          {role === 'camera' ? (
            <button
              type="button"
              onClick={onRequestControllerLogin}
              className="px-3.5 py-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/35 text-xs font-semibold text-sky-200 cursor-pointer"
            >
              Switch to Controller (Login)
            </button>
          ) : (
            <>
              <button
                type="button"
                data-testid="pair-arduino-btn"
                onClick={handleConnectSerial}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-all ${
                  serialConnected
                    ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                    : 'bg-amber-400 hover:bg-amber-300 border-amber-300 text-slate-950'
                }`}
              >
                {serialConnected ? '● Arduino USB Paired (COM)' : '⚡ Pair Arduino USB (COM Port)'}
              </button>

              <button
                type="button"
                data-testid="open-arduino-code-btn"
                onClick={() => setShowArduinoCodeModal(true)}
                className="px-3.5 py-2 rounded-lg bg-white/8 hover:bg-white/15 border border-white/20 text-xs font-medium text-white cursor-pointer"
              >
                📋 Copy Arduino IDE Code (.ino)
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
        {role === 'camera' ? (
          /* ======================================================================
           * VIEW 1: SMARTPHONE CAMERA NODE VIEW
           * Opened when any user clicks "Camera" on the landing page and grants
           * camera permission to stream their phone camera to the Controller.
           * ====================================================================== */
          <div className="max-w-3xl mx-auto space-y-5">
            <div className="rounded-2xl bg-[#111622] border border-white/10 p-5 md:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-emerald-400 block">
                    LIVE CLASSROOM CAMERA NODE · ROOM {roomId}
                  </span>
                  <h2 className="text-xl font-semibold text-white m-0 mt-0.5">
                    Smartphone Camera Stream Active
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = facingMode === 'environment' ? 'user' : 'environment';
                      setFacingMode(next);
                      startLocalCamera(next);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-white cursor-pointer"
                  >
                    Flip Camera ({facingMode === 'environment' ? 'Rear' : 'Front'})
                  </button>

                  {localCameraActive ? (
                    <button
                      type="button"
                      onClick={stopLocalCamera}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-xs text-rose-200 cursor-pointer"
                    >
                      Stop Camera
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startLocalCamera(facingMode)}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-400 text-slate-950 font-semibold text-xs cursor-pointer"
                    >
                      Grant Camera Permission
                    </button>
                  )}
                </div>
              </div>

              {/* Camera Viewport */}
              <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-white/15 flex items-center justify-center">
                <video
                  ref={localVideoRef}
                  playsInline
                  muted
                  autoPlay
                  className={`w-full h-full object-cover ${localCameraActive ? 'block' : 'hidden'}`}
                />
                <canvas
                  ref={overlayCanvasRef}
                  className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${
                    localCameraActive ? 'block' : 'hidden'
                  }`}
                />

                {!localCameraActive && (
                  <div className="text-center p-6 max-w-md">
                    <p className="text-sm text-white/80 font-medium mb-2">
                      Allow camera permission to stream classroom footage to the Controller
                    </p>
                    {cameraError && (
                      <p className="text-xs text-rose-400 mb-3">{cameraError}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => startLocalCamera(facingMode)}
                      className="px-5 py-2.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs cursor-pointer"
                    >
                      Enable Smartphone Camera
                    </button>
                  </div>
                )}

                {/* Live Overlay Badges */}
                <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/15">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      localCameraActive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                    }`}
                  />
                  <span className="text-xs font-semibold text-white">
                    {localCameraActive
                      ? 'Streaming Live to Controller Feed'
                      : 'Waiting for Camera Permission'}
                  </span>
                </div>

                <div className="absolute top-3 right-3 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-emerald-400/40">
                  <span className="text-xs font-semibold text-emerald-300">
                    Persons in View: {rawDetectedCount}
                  </span>
                </div>
              </div>

              {/* Status Footer on Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <span className="text-[11px] text-white/50 block">AI Vision Status</span>
                  <span className="text-sm font-semibold text-white">
                    {aiModelLoading
                      ? 'Loading COCO-SSD...'
                      : aiModelLoaded
                      ? 'COCO-SSD Person Detection Active'
                      : 'Ready'}
                  </span>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <span className="text-[11px] text-white/50 block">Fan 1 (Motor 1 — OUT1/OUT2)</span>
                  <span className="text-sm font-semibold text-emerald-300">{fan1Speed}% Speed</span>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <span className="text-[11px] text-white/50 block">Fan 2 (Motor 2 — OUT3/OUT4)</span>
                  <span className="text-sm font-semibold text-sky-300">{fan2Speed}% Speed</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ======================================================================
           * VIEW 2: PASSWORD-PROTECTED CONTROLLER DASHBOARD
           * Has two mode buttons ("Manually" & "AI Model") and shows the common
           * live camera feed in BOTH modes, plus independent Fan 1 & Fan 2 controls.
           * ====================================================================== */
          <div className="space-y-6">
            {/* Mode Selector Bar: Two prominent buttons — "Manually" vs "AI Model" */}
            <div className="rounded-2xl bg-[#111622] border border-white/10 p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-sky-400 block">
                  CONTROLLER OPERATING MODE
                </span>
                <p className="text-xs text-white/65 m-0 mt-0.5">
                  Both modes share the live classroom camera feed below. Switch between Manual human decision or automatic AI Occupancy rules.
                </p>
              </div>

              <div className="flex items-center gap-2.5 bg-[#090c14] p-1.5 rounded-xl border border-white/10">
                <button
                  type="button"
                  data-testid="mode-btn-manual"
                  onClick={() => setControlMode('manual')}
                  className={`px-5 py-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                    controlMode === 'manual'
                      ? 'bg-sky-400 text-slate-950 shadow-sm'
                      : 'bg-transparent text-white/70 hover:text-white'
                  }`}
                >
                  Manually (Human Control)
                </button>

                <button
                  type="button"
                  data-testid="mode-btn-ai"
                  onClick={() => setControlMode('ai')}
                  className={`px-5 py-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                    controlMode === 'ai'
                      ? 'bg-emerald-400 text-slate-950 shadow-sm'
                      : 'bg-transparent text-white/70 hover:text-white'
                  }`}
                >
                  AI Model (Auto Occupancy)
                </button>
              </div>
            </div>

            {/* Two-Column Main Grid: Left = Common Live Camera Feed, Right = Active Mode Controls */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* LEFT COLUMN (7 cols): Common Live Classroom Camera Feed (Visible in BOTH Modes) */}
              <div className="lg:col-span-7 flex flex-col gap-4">
                <div className="rounded-2xl bg-[#111622] border border-white/10 p-5 flex-1 flex flex-col">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400 block">
                        COMMON LIVE CAMERA FEED ({controlMode === 'ai' ? 'AI MODEL MODE' : 'MANUAL MODE'})
                      </span>
                      <h2 className="text-base font-semibold text-white m-0">
                        Classroom Vision Sensor · Room {roomId}
                      </h2>
                    </div>

                    <div className="flex items-center gap-2">
                      {!localCameraActive ? (
                        <button
                          type="button"
                          data-testid="controller-start-cam-btn"
                          onClick={() => startLocalCamera('user')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-400/20 hover:bg-emerald-400/30 border border-emerald-400/40 text-xs font-semibold text-emerald-200 cursor-pointer"
                        >
                          📷 Turn On Local Camera
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={stopLocalCamera}
                          className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-xs font-semibold text-rose-200 cursor-pointer"
                        >
                          Stop Local Camera
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Video / Remote Stream Stage */}
                  <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-[#05070b] border border-white/15 flex items-center justify-center">
                    {/* Local Camera Video */}
                    <video
                      ref={localVideoRef}
                      playsInline
                      muted
                      autoPlay
                      className={`w-full h-full object-cover ${
                        localCameraActive ? 'block' : 'hidden'
                      }`}
                    />

                    {/* WebRTC Remote Video Stream from Smartphone */}
                    <video
                      ref={remoteVideoRef}
                      playsInline
                      muted
                      autoPlay
                      className={`w-full h-full object-cover ${
                        !localCameraActive && remoteStreamActive ? 'block' : 'hidden'
                      }`}
                    />

                    {/* WebSocket Remote Frame Image from Smartphone */}
                    {!localCameraActive && !remoteStreamActive && remoteFrameUrl && (
                      <img
                        ref={remoteImgRef}
                        src={remoteFrameUrl}
                        alt="Live Smartphone Classroom Feed"
                        className="w-full h-full object-cover block"
                      />
                    )}

                    {/* Bounding Boxes Overlay Canvas */}
                    <canvas
                      ref={overlayCanvasRef}
                      className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${
                        hasAnyVideoFeed ? 'block' : 'hidden'
                      }`}
                    />

                    {/* Empty State when neither Smartphone Camera nor Local Camera is active */}
                    {!hasAnyVideoFeed && (
                      <div className="text-center p-6 max-w-md space-y-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/70">
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                          Waiting for Smartphone Camera Feed...
                        </div>
                        <p className="text-xs text-white/60 leading-relaxed m-0">
                          Open this website on your smartphone and click <strong>Camera</strong> to stream live footage here automatically—or click below to use this laptop&apos;s camera right now.
                        </p>
                        {cameraError && (
                          <p className="text-xs text-rose-400 m-0">{cameraError}</p>
                        )}
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => startLocalCamera('user')}
                            className="px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs cursor-pointer"
                          >
                            Use Laptop Camera Now
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Top-Left Feed Source Badge */}
                    <div className="absolute top-3 left-3 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/15 flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          hasAnyVideoFeed ? 'bg-emerald-400 animate-pulse' : 'bg-white/40'
                        }`}
                      />
                      <span className="text-[11px] font-medium text-white">
                        {localCameraActive
                          ? 'Source: Local Camera (Live AI)'
                          : remoteCameraOnline || remoteFrameUrl
                          ? 'Source: Smartphone Camera Node (Live)'
                          : 'Standby'}
                      </span>
                    </div>

                    {/* Top-Right Person Count Badge */}
                    <div
                      data-testid="live-person-count-badge"
                      className="absolute top-3 right-3 bg-black/80 backdrop-blur-md px-3.5 py-1.5 rounded-lg border border-emerald-400/50"
                    >
                      <span className="text-xs font-bold text-emerald-300">
                        Persons in Camera: {effectivePersonCount}
                      </span>
                    </div>
                  </div>

                  {/* Live Motor Status Strip below video */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                    <div className="rounded-xl bg-[#090c14] border border-white/10 p-3">
                      <span className="text-[10px] uppercase tracking-wider text-white/45 block">
                        Active Mode
                      </span>
                      <span className="text-xs font-semibold text-white mt-0.5 block">
                        {controlMode === 'ai' ? 'AI Auto Occupancy' : 'Manual Operator'}
                      </span>
                    </div>

                    <div className="rounded-xl bg-[#090c14] border border-white/10 p-3">
                      <span className="text-[10px] uppercase tracking-wider text-white/45 block">
                        Fan 1 (OUT1/OUT2 · D2/D3)
                      </span>
                      <span
                        data-testid="status-fan1-speed"
                        className="text-sm font-bold text-emerald-300 mt-0.5 block"
                      >
                        {fan1Speed === 0 ? 'OFF (0%)' : `${fan1Speed}% Speed`}
                      </span>
                    </div>

                    <div className="rounded-xl bg-[#090c14] border border-white/10 p-3">
                      <span className="text-[10px] uppercase tracking-wider text-white/45 block">
                        Fan 2 (OUT3/OUT4 · D4/D5)
                      </span>
                      <span
                        data-testid="status-fan2-speed"
                        className="text-sm font-bold text-sky-300 mt-0.5 block"
                      >
                        {fan2Speed === 0 ? 'OFF (0%)' : `${fan2Speed}% Speed`}
                      </span>
                    </div>

                    <div className="rounded-xl bg-[#090c14] border border-white/10 p-3">
                      <span className="text-[10px] uppercase tracking-wider text-white/45 block">
                        Serial TX → UNO
                      </span>
                      <code className="text-xs font-mono text-amber-300 mt-0.5 block">
                        {lastTxCommand}
                      </code>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN (5 cols): Mode-Specific Control Panel (Manually vs AI Model) */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                {controlMode === 'manual' ? (
                  /* ----------------------------------------------------------------
                   * MANUALLY MODE PANEL
                   * Independent controls for Fan 1 (Motor 1) and Fan 2 (Motor 2)
                   * ---------------------------------------------------------------- */
                  <div
                    data-testid="manual-control-panel"
                    className="rounded-2xl bg-[#111622] border border-sky-400/30 p-5 space-y-5"
                  >
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-sky-400 block">
                        MANUAL HUMAN CONTROL MODE
                      </span>
                      <h3 className="text-lg font-semibold text-white m-0 mt-0.5">
                        Independent Dual-Fan Control
                      </h3>
                      <p className="text-xs text-white/60 m-0 mt-1">
                        Watch the live camera feed and control Fan 1 (Motor 1) and Fan 2 (Motor 2) independently.
                      </p>
                    </div>

                    {/* FAN 1 (MOTOR 1) INDEPENDENT CARD */}
                    <div className="rounded-xl bg-[#090c14] border border-white/10 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-white block">
                            Fan 1 — Motor 1 (OUT1 &amp; OUT2)
                          </span>
                          <span className="text-[11px] text-white/45">
                            Arduino Pins: IN1 → D2, IN2 → D3 (PWM)
                          </span>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                            fan1Speed > 0
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-white/5 text-white/50 border border-white/10'
                          }`}
                        >
                          {fan1Speed === 0 ? 'OFF (0%)' : `ON · ${fan1Speed}%`}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: 'OFF (0%)', val: 0 },
                          { label: 'MID (50%)', val: 50 },
                          { label: 'FULL (100%)', val: 100 },
                        ].map((btn) => (
                          <button
                            key={btn.val}
                            type="button"
                            data-testid={`manual-fan1-${btn.val}`}
                            onClick={() => applyManualFanChange(btn.val, fan2Speed)}
                            className={`py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-all ${
                              fan1Speed === btn.val
                                ? 'bg-emerald-400 text-slate-950 border-emerald-300'
                                : 'bg-white/5 hover:bg-white/10 text-white/80 border-white/10'
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* FAN 2 (MOTOR 2) INDEPENDENT CARD */}
                    <div className="rounded-xl bg-[#090c14] border border-white/10 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-white block">
                            Fan 2 — Motor 2 (OUT3 &amp; OUT4)
                          </span>
                          <span className="text-[11px] text-white/45">
                            Arduino Pins: IN3 → D4, IN4 → D5 (PWM)
                          </span>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                            fan2Speed > 0
                              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                              : 'bg-white/5 text-white/50 border border-white/10'
                          }`}
                        >
                          {fan2Speed === 0 ? 'OFF (0%)' : `ON · ${fan2Speed}%`}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: 'OFF (0%)', val: 0 },
                          { label: 'MID (50%)', val: 50 },
                          { label: 'FULL (100%)', val: 100 },
                        ].map((btn) => (
                          <button
                            key={btn.val}
                            type="button"
                            data-testid={`manual-fan2-${btn.val}`}
                            onClick={() => applyManualFanChange(fan1Speed, btn.val)}
                            className={`py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-all ${
                              fan2Speed === btn.val
                                ? 'bg-sky-400 text-slate-950 border-sky-300'
                                : 'bg-white/5 hover:bg-white/10 text-white/80 border-white/10'
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Quick Isolated Motor Combinations (Verifies Bug #1 Fix) */}
                    <div className="space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50 block">
                        Quick Hardware Combinations
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          data-testid="only-fan1-btn"
                          onClick={() => applyManualFanChange(100, 0)}
                          className="py-2 px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-xs font-semibold text-emerald-200 cursor-pointer"
                        >
                          Only Fan 1 ON (Motor 1)
                        </button>
                        <button
                          type="button"
                          data-testid="only-fan2-btn"
                          onClick={() => applyManualFanChange(0, 100)}
                          className="py-2 px-3 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-xs font-semibold text-sky-200 cursor-pointer"
                        >
                          Only Fan 2 ON (Motor 2)
                        </button>
                        <button
                          type="button"
                          data-testid="both-fans-on-btn"
                          onClick={() => applyManualFanChange(100, 100)}
                          className="py-2 px-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-xs font-semibold text-amber-200 cursor-pointer"
                        >
                          Both Fans ON (100%)
                        </button>
                        <button
                          type="button"
                          data-testid="both-fans-off-btn"
                          onClick={() => applyManualFanChange(0, 0)}
                          className="py-2 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-xs font-semibold text-rose-200 cursor-pointer"
                        >
                          All Fans OFF (0%)
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ----------------------------------------------------------------
                   * AI MODEL MODE PANEL
                   * Automatic Occupancy Rules (0, 1, 2, 3, 4+ Persons)
                   * ---------------------------------------------------------------- */
                  <div
                    data-testid="ai-control-panel"
                    className="rounded-2xl bg-[#111622] border border-emerald-400/30 p-5 space-y-4"
                  >
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400 block">
                        AUTONOMOUS AI MODEL MODE
                      </span>
                      <h3 className="text-lg font-semibold text-white m-0 mt-0.5">
                        Predefined Occupancy Speed Rules
                      </h3>
                      <p className="text-xs text-white/60 m-0 mt-1">
                        AI counts people in the classroom camera feed and automatically drives Motor 1 and Motor 2.
                      </p>
                    </div>

                    {/* Active AI Decision Banner */}
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/35 p-3.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-emerald-300">
                          {currentAiDecision.ruleTitle}
                        </span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-400/20 text-emerald-200">
                          {aiCountOverride === null ? 'Live Camera AI' : 'Manual Test Count'}
                        </span>
                      </div>
                      <p className="text-xs text-white/80 m-0">
                        {currentAiDecision.ruleDescription}
                      </p>
                    </div>

                    {/* All 5 Rules Table (Highlights currently active rule) */}
                    <div className="space-y-1.5">
                      {[
                        { count: 0, title: '0 Persons', desc: 'Both Motors OFF (0%) · Lights OFF' },
                        { count: 1, title: '1 Person', desc: 'Motor 1: 50% Speed · Motor 2: OFF' },
                        { count: 2, title: '2 Persons', desc: 'Motor 1: 100% Speed · Motor 2: OFF' },
                        { count: 3, title: '3 Persons', desc: 'Motor 1: 50% · Motor 2: 50% Speed' },
                        { count: 4, title: '4+ Persons', desc: 'Motor 1: 100% · Motor 2: 100% Speed' },
                      ].map((rule) => {
                        const isCurrent =
                          rule.count === 4
                            ? effectivePersonCount >= 4
                            : effectivePersonCount === rule.count;
                        return (
                          <div
                            key={rule.count}
                            className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-all ${
                              isCurrent
                                ? 'bg-emerald-400/20 border-emerald-400 text-white font-semibold'
                                : 'bg-[#090c14] border-white/8 text-white/55'
                            }`}
                          >
                            <span>{rule.title}</span>
                            <span>{rule.desc}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Live Camera AI vs Demo Count Tester (for Viva / Hardware Testing) */}
                    <div className="pt-2 border-t border-white/10 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-white/60">
                          Test Occupancy Count (or keep on Auto Camera AI):
                        </span>
                        <button
                          type="button"
                          onClick={() => setAiCountOverride(null)}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                            aiCountOverride === null
                              ? 'bg-emerald-400 text-slate-950'
                              : 'bg-white/10 text-white/70 hover:text-white'
                          }`}
                        >
                          Auto Live Camera ({rawDetectedCount})
                        </button>
                      </div>

                      <div className="grid grid-cols-5 gap-1.5">
                        {[0, 1, 2, 3, 4].map((num) => (
                          <button
                            key={num}
                            type="button"
                            data-testid={`ai-sim-count-${num}`}
                            onClick={() => setAiCountOverride(num)}
                            className={`py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-all ${
                              aiCountOverride === num
                                ? 'bg-emerald-400 text-slate-950 border-emerald-300'
                                : 'bg-[#090c14] hover:bg-white/10 text-white/75 border-white/10'
                            }`}
                          >
                            {num === 4 ? '4+ Pers' : `${num} Pers`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Arduino UNO & L298N Hardware Status Card */}
                <div className="rounded-2xl bg-[#111622] border border-white/10 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">
                      Arduino UNO SMD + L298N Hardware Link
                    </span>
                    <span
                      className={`text-[11px] font-medium ${
                        serialConnected ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      {serialStatus}
                    </span>
                  </div>
                  <div className="text-[11px] text-white/55 flex flex-wrap items-center justify-between gap-2 bg-[#090c14] px-3 py-2 rounded-lg border border-white/8">
                    <span>Pins: D2→IN1, D3(PWM)→IN2, D4→IN3, D5(PWM)→IN4</span>
                    <span className="font-mono text-emerald-300">RX: {lastArduinoReply}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal: Complete Arduino IDE (.ino) Code with Anti-Jerking Fix */}
      {showArduinoCodeModal && (
        <div
          data-testid="arduino-code-modal"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl bg-[#0e131f] border border-white/20 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-[#141b2d] border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-white m-0">
                  tejprakash_arduino.ino — Anti-Jerking Firmware (Arduino UNO SMD)
                </h3>
                <p className="text-xs text-white/60 m-0 mt-0.5">
                  Paste directly into Arduino IDE 2.3.10 and click Upload. No rewiring needed (uses D2, D3, D4, D5).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(ARDUINO_INO_CODE);
                    setCopiedCode(true);
                    window.setTimeout(() => setCopiedCode(false), 2000);
                  }}
                  className="px-4 py-2 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs cursor-pointer"
                >
                  {copiedCode ? '✓ Copied to Clipboard!' : 'Copy Full .ino Code'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowArduinoCodeModal(false)}
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white cursor-pointer"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            <pre className="p-5 text-xs font-mono text-emerald-200 overflow-y-auto flex-1 m-0 leading-relaxed bg-[#070a10]">
              {ARDUINO_INO_CODE}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
