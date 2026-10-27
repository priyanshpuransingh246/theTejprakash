import React, { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import {
  ARDUINO_INO_CODE,
  computeAiFanDecision,
  ControlMode,
  formatArduinoCommand,
  setStoredAdminPassword,
  verifyAdminPassword,
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

// Reusable Smoked-Glass Slab class matching the WebGL Landing Hero's #17171b extruded glass
const GLASS_SLAB_CLASS =
  'relative rounded-[20px] bg-[#16161b]/88 backdrop-blur-2xl border border-white/[0.11] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.20),inset_1px_0_0_0_rgba(255,255,255,0.08),0_24px_60px_rgba(0,0,0,0.78)]';

const GLASS_SUBSLAB_CLASS =
  'relative rounded-[14px] bg-[#0d0d11]/90 border border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10)]';

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

  // Controller mode: 'manual' vs 'ai'
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
  const [serialStatus, setSerialStatus] = useState<string>('USB Standby');
  const [lastTxCommand, setLastTxCommand] = useState<string>('F1:0,F2:0');
  const [lastArduinoReply, setLastArduinoReply] = useState<string>('—');
  const [showArduinoCodeModal, setShowArduinoCodeModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Admin Password Change Modal State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPwdInput, setCurrentPwdInput] = useState('');
  const [newPwdInput, setNewPwdInput] = useState('');
  const [confirmPwdInput, setConfirmPwdInput] = useState('');
  const [pwdChangeError, setPwdChangeError] = useState<string | null>(null);
  const [pwdChangeSuccess, setPwdChangeSuccess] = useState<string | null>(null);

  // Refs for media, canvas, WebSocket, PeerJS, and Serial
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteImgRef = useRef<HTMLImageElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cloudThumbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const ntfyWsRef = useRef<WebSocket | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const peerConnRef = useRef<DataConnection | null>(null);
  const openPeerConnsRef = useRef<Map<string, DataConnection>>(new Map());
  const mediaCallRef = useRef<MediaConnection | null>(null);
  const myPeerIdRef = useRef<string>('');
  const latestCountRef = useRef<number>(0);
  const latestBoxesRef = useRef<DetectedPersonBox[]>([]);
  const lastCloudRelayMsRef = useRef<number>(0);

  const serialPortRef = useRef<WebSerialPort | null>(null);
  const lastSentCmdRef = useRef<string>('');
  const lastSentTimeRef = useRef<number>(0);

  useEffect(() => {
    setRole(initialRole);
  }, [initialRole]);

  const hasActiveVisionInput =
    localCameraActive || remoteStreamActive || Boolean(remoteFrameUrl);

  // Load COCO-SSD AI person detection model on demand when a camera feed is active
  useEffect(() => {
    if (!visible || !hasActiveVisionInput) return;
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
  }, [visible, hasActiveVisionInput]);

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
      setSerialStatus('Use Chrome/Edge on Laptop for USB Serial');
      return;
    }

    try {
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 9600 });
      serialPortRef.current = port;
      setSerialConnected(true);
      setSerialStatus('UNO Paired (9600 baud)');

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

      window.setTimeout(() => {
        sendCommandToArduino(fan1Speed, fan2Speed, true);
      }, 1600);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cancelled';
      setSerialStatus(`USB: ${msg}`);
    }
  };

  // Start or stop local camera
  const startLocalCamera = useCallback(
    async (preferredFacing: 'environment' | 'user' = facingMode) => {
      setCameraError(null);
      try {
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera permission requires HTTPS or localhost');
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

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => {
      if (role === 'camera' && !localCameraActive) {
        startLocalCamera(facingMode);
      }
    }, 920);
    return () => window.clearTimeout(timer);
  }, [visible, role, localCameraActive, facingMode, startLocalCamera]);

  useEffect(() => {
    if (!visible && localCameraActive) {
      stopLocalCamera();
    }
  }, [visible, localCameraActive, stopLocalCamera]);

  // Real-time Multi-Transport Link:
  // 1. PeerJS WebRTC (with Google STUN + OpenRelay TURN + Multi-Slot Controller IDs + Bidirectional Discovery)
  // 2. Cloud WebSocket Relay (wss://ntfy.sh) so Smartphone (4G/5G) -> Laptop (Wi-Fi) works on static Vercel even behind strict NAT
  // 3. Express /ws & /api/room HTTP fallback + BroadcastChannel
  useEffect(() => {
    if (!visible) return;

    let unmounted = false;
    const roomClean = roomId.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ntfyTopic = `tejprakash_live_v3_${roomClean}`;

    const handleIncomingFramePacket = (data: {
      type?: string;
      frameDataUrl?: string;
      personCount?: number;
      boxes?: DetectedPersonBox[];
      camPeerId?: string;
      fan1Speed?: number;
      fan2Speed?: number;
      newPassword?: string;
    }) => {
      if (!data || unmounted) return;

      if (data.type === 'camera:frame' && role === 'controller') {
        if (data.frameDataUrl) {
          setRemoteFrameUrl(data.frameDataUrl);
          setRemoteCameraOnline(true);
        }
        if (typeof data.personCount === 'number' && data.personCount >= 0) {
          latestCountRef.current = data.personCount;
          setRawDetectedCount(data.personCount);
        }
        if (Array.isArray(data.boxes)) {
          latestBoxesRef.current = data.boxes;
          setDetectedBoxes(data.boxes);
        }
        // If Camera shared its PeerJS ID and we aren't connected to it yet, connect back from Controller!
        if (
          data.camPeerId &&
          peerRef.current &&
          !peerRef.current.disconnected &&
          !peerRef.current.destroyed &&
          !openPeerConnsRef.current.has(data.camPeerId)
        ) {
          try {
            const backConn = peerRef.current.connect(data.camPeerId, { reliable: true });
            setupDataConn(backConn);
          } catch {
            // Ignore
          }
        }
      } else if (data.type === 'controller:update' && role === 'camera') {
        if (typeof data.fan1Speed === 'number' && typeof data.fan2Speed === 'number') {
          onFanSpeedChange(data.fan1Speed, data.fan2Speed);
        }
      } else if (data.type === 'admin:password_changed' && typeof data.newPassword === 'string') {
        setStoredAdminPassword(data.newPassword);
      }
    };

    const setupDataConn = (conn: DataConnection) => {
      if (!conn) return;
      conn.on('open', () => {
        if (unmounted) return;
        openPeerConnsRef.current.set(conn.peer, conn);
        peerConnRef.current = conn;
      });
      conn.on('data', (raw: unknown) => {
        if (typeof raw === 'string') {
          try {
            handleIncomingFramePacket(JSON.parse(raw));
          } catch {
            // Ignore
          }
        } else if (raw && typeof raw === 'object') {
          handleIncomingFramePacket(raw as Record<string, unknown>);
        }
      });
      conn.on('close', () => {
        openPeerConnsRef.current.delete(conn.peer);
      });
      conn.on('error', () => {
        openPeerConnsRef.current.delete(conn.peer);
      });
    };

    // 1. BroadcastChannel (instant same-browser sync)
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(`tejprakash_${roomId}`);
      bcRef.current = bc;
      bc.onmessage = (ev) => handleIncomingFramePacket(ev.data);
    }

    // 2. Local /ws WebSocket (when running with server.ts)
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connectWs = () => {
      if (unmounted) return;
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          ws?.send(JSON.stringify({ type: 'room:join', roomId, role }));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'room:init' && msg.state && role === 'controller') {
              if (msg.state.latestFrameDataUrl) {
                setRemoteFrameUrl(msg.state.latestFrameDataUrl);
                setRemoteCameraOnline(Boolean(msg.state.cameraActive));
                setRawDetectedCount(msg.state.personCount || 0);
                setDetectedBoxes(msg.state.boxes || []);
              }
            } else if (msg.type === 'camera:stopped' && role === 'controller') {
              setRemoteCameraOnline(false);
            } else if (msg.type === 'presence:update' && role === 'controller') {
              setRemoteCameraOnline(Boolean(msg.cameraActive));
            } else {
              handleIncomingFramePacket(msg);
            }
          } catch {
            // Ignore
          }
        };

        ws.onclose = () => {
          if (!unmounted) {
            reconnectTimer = window.setTimeout(connectWs, 3500);
          }
        };
      } catch {
        // Fallback to Cloud WSS & PeerJS
      }
    };

    // 3. Cloud WebSocket Relay (wss://ntfy.sh) for cross-network Vercel deployments
    let ntfyWs: WebSocket | null = null;
    let ntfyReconnectTimer: number | null = null;
    const connectNtfyCloudRelay = () => {
      if (unmounted) return;
      try {
        ntfyWs = new WebSocket(`wss://ntfy.sh/${ntfyTopic}/ws`);
        ntfyWsRef.current = ntfyWs;
        ntfyWs.onmessage = (ev) => {
          try {
            const wrapper = JSON.parse(ev.data);
            if (wrapper && wrapper.event === 'message' && typeof wrapper.message === 'string') {
              const inner = JSON.parse(wrapper.message);
              handleIncomingFramePacket(inner);
            }
          } catch {
            // Ignore non-JSON keepalives
          }
        };
        ntfyWs.onclose = () => {
          if (!unmounted) {
            ntfyReconnectTimer = window.setTimeout(connectNtfyCloudRelay, 3000);
          }
        };
      } catch {
        // Ignore
      }
    };

    // 4. PeerJS WebRTC with STUN + TURN servers & multi-slot automatic fallback
    let peer: Peer | null = null;
    let peerRetryTimer: number | null = null;
    let ctrlSlotIndex = 0;

    const ctrlSlots = [
      `tejprakash-ctrl-${roomClean}`,
      `tejprakash-ctrl-${roomClean}-1`,
      `tejprakash-ctrl-${roomClean}-2`,
    ];

    const iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    };

    const startPeerInstance = (customId?: string) => {
      if (unmounted) return;
      const desiredId =
        customId ||
        (role === 'controller'
          ? ctrlSlots[Math.min(ctrlSlotIndex, ctrlSlots.length - 1)]
          : `tejprakash-cam-${roomClean}-${Math.floor(1000 + Math.random() * 9000)}`);

      try {
        peer?.destroy();
        peer = new Peer(desiredId, { config: iceConfig });
        peerRef.current = peer;

        const tryConnectCameraToControllers = () => {
          if (unmounted || role !== 'camera' || !peer || peer.disconnected || peer.destroyed)
            return;
          for (const targetCtrlId of ctrlSlots) {
            const existing = openPeerConnsRef.current.get(targetCtrlId);
            if (!existing || !existing.open) {
              try {
                const conn = peer.connect(targetCtrlId, { reliable: true });
                setupDataConn(conn);
              } catch {
                // Ignore
              }
            }
            if (mediaStreamRef.current && (!mediaCallRef.current || !mediaCallRef.current.open)) {
              try {
                mediaCallRef.current = peer.call(targetCtrlId, mediaStreamRef.current);
              } catch {
                // Ignore
              }
            }
          }
        };

        peer.on('open', (id) => {
          myPeerIdRef.current = id;
          if (role === 'camera') {
            tryConnectCameraToControllers();
            if (peerRetryTimer !== null) window.clearInterval(peerRetryTimer);
            peerRetryTimer = window.setInterval(tryConnectCameraToControllers, 3500);
          }
        });

        peer.on('connection', (conn) => {
          setupDataConn(conn);
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

        peer.on('error', (err: { type?: string }) => {
          if (unmounted) return;
          if (err?.type === 'unavailable-id' && role === 'controller') {
            ctrlSlotIndex += 1;
            const fallbackId =
              ctrlSlotIndex < ctrlSlots.length
                ? ctrlSlots[ctrlSlotIndex]
                : `tejprakash-ctrl-${roomClean}-${Math.floor(100 + Math.random() * 899)}`;
            window.setTimeout(() => startPeerInstance(fallbackId), 350);
          }
        });
      } catch {
        // Ignore
      }
    };

    const initNetworkTimer = window.setTimeout(() => {
      if (unmounted) return;
      connectWs();
      connectNtfyCloudRelay();
      startPeerInstance();
    }, 550);

    return () => {
      unmounted = true;
      window.clearTimeout(initNetworkTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (ntfyReconnectTimer !== null) window.clearTimeout(ntfyReconnectTimer);
      if (peerRetryTimer !== null) window.clearInterval(peerRetryTimer);
      openPeerConnsRef.current.clear();
      ws?.close();
      ntfyWs?.close();
      bc?.close();
      peer?.destroy();
    };
  }, [visible, role, roomId, onFanSpeedChange]);

  // Immediately initiate PeerJS call/connect as soon as local camera stream turns on
  useEffect(() => {
    if (
      role === 'camera' &&
      localCameraActive &&
      mediaStreamRef.current &&
      peerRef.current &&
      !peerRef.current.disconnected
    ) {
      const roomClean = roomId.toLowerCase().replace(/[^a-z0-9]/g, '');
      const ctrlSlots = [
        `tejprakash-ctrl-${roomClean}`,
        `tejprakash-ctrl-${roomClean}-1`,
        `tejprakash-ctrl-${roomClean}-2`,
      ];
      for (const targetCtrlId of ctrlSlots) {
        try {
          mediaCallRef.current = peerRef.current.call(targetCtrlId, mediaStreamRef.current);
          if (!openPeerConnsRef.current.has(targetCtrlId)) {
            const conn = peerRef.current.connect(targetCtrlId, { reliable: true });
            conn.on('open', () => {
              openPeerConnsRef.current.set(conn.peer, conn);
              peerConnRef.current = conn;
            });
          }
        } catch {
          // Ignore
        }
      }
    }
  }, [role, localCameraActive, roomId]);

  // LOOP 1: Non-Blocking Fast Camera Frame Broadcaster (Starts immediately when Camera is ON, does NOT wait for COCO-SSD!)
  useEffect(() => {
    if (!visible || role !== 'camera' || !localCameraActive) return;
    let active = true;
    let frameTimer: number | null = null;
    const roomClean = roomId.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ntfyTopic = `tejprakash_live_v3_${roomClean}`;

    const broadcastFrameTick = () => {
      if (!active) return;
      const videoEl = localVideoRef.current;
      if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        let canvas = captureCanvasRef.current;
        if (!canvas) {
          canvas = document.createElement('canvas');
          captureCanvasRef.current = canvas;
        }
        const targetW = 320;
        const targetH = Math.round((videoEl.videoHeight / videoEl.videoWidth) * targetW) || 240;
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoEl, 0, 0, targetW, targetH);
          const scaleX = targetW / videoEl.videoWidth;
          const scaleY = targetH / videoEl.videoHeight;
          const scaledBoxes: DetectedPersonBox[] = latestBoxesRef.current.map((b) => ({
            bbox: [
              Math.round(b.bbox[0] * scaleX),
              Math.round(b.bbox[1] * scaleY),
              Math.round(b.bbox[2] * scaleX),
              Math.round(b.bbox[3] * scaleY),
            ],
            score: Math.round(b.score * 100) / 100,
          }));

          const frameDataUrl = canvas.toDataURL('image/jpeg', 0.48);
          const packet = {
            type: 'camera:frame',
            roomId,
            camPeerId: myPeerIdRef.current || undefined,
            frameDataUrl,
            personCount: latestCountRef.current,
            boxes: scaledBoxes,
          };

          // 1. Send over Local WebSocket (/ws)
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(packet));
          }
          // 2. Send over BroadcastChannel (same browser)
          if (bcRef.current) {
            bcRef.current.postMessage(packet);
          }
          // 3. Send over all open PeerJS WebRTC DataConnections
          openPeerConnsRef.current.forEach((conn) => {
            if (conn && conn.open) {
              try {
                conn.send(packet);
              } catch {
                // Ignore
              }
            }
          });

          // 4. Every 850ms, also push a compact (<3.6KB) cloud frame to ntfy.sh so cross-network Vercel works even before/without WebRTC P2P
          const nowMs = performance.now();
          if (nowMs - lastCloudRelayMsRef.current >= 850) {
            lastCloudRelayMsRef.current = nowMs;
            let thumbCanvas = cloudThumbCanvasRef.current;
            if (!thumbCanvas) {
              thumbCanvas = document.createElement('canvas');
              cloudThumbCanvasRef.current = thumbCanvas;
            }
            const tw = 160;
            const th = Math.round((videoEl.videoHeight / videoEl.videoWidth) * tw) || 120;
            thumbCanvas.width = tw;
            thumbCanvas.height = th;
            const tctx = thumbCanvas.getContext('2d');
            if (tctx) {
              tctx.drawImage(videoEl, 0, 0, tw, th);
              const tScaleX = tw / videoEl.videoWidth;
              const tScaleY = th / videoEl.videoHeight;
              const compactBoxes: DetectedPersonBox[] = latestBoxesRef.current.map((b) => ({
                bbox: [
                  Math.round(b.bbox[0] * tScaleX),
                  Math.round(b.bbox[1] * tScaleY),
                  Math.round(b.bbox[2] * tScaleX),
                  Math.round(b.bbox[3] * tScaleY),
                ],
                score: Math.round(b.score * 100) / 100,
              }));
              const compactUrl = thumbCanvas.toDataURL('image/jpeg', 0.34);
              const cloudPacket = JSON.stringify({
                type: 'camera:frame',
                camPeerId: myPeerIdRef.current || undefined,
                frameDataUrl: compactUrl,
                personCount: latestCountRef.current,
                boxes: compactBoxes,
              });
              if (cloudPacket.length < 3950) {
                fetch(`https://ntfy.sh/${ntfyTopic}`, {
                  method: 'POST',
                  body: cloudPacket,
                }).catch(() => {});
              }
            }
          }
        }
      }

      if (active) {
        frameTimer = window.setTimeout(broadcastFrameTick, 210);
      }
    };

    frameTimer = window.setTimeout(broadcastFrameTick, 120);
    return () => {
      active = false;
      if (frameTimer !== null) window.clearTimeout(frameTimer);
    };
  }, [visible, role, localCameraActive, roomId]);

  // LOOP 2: Asynchronous AI Person Detection Loop (Runs in background without blocking video streaming)
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let timerId: number | null = null;

    const detectionLoop = async () => {
      if (!active) return;

      const videoEl = localCameraActive
        ? localVideoRef.current
        : remoteStreamActive
        ? remoteVideoRef.current
        : null;

      if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        const { count, boxes } = await detectPersonsInElement(videoEl, 0.4);
        if (!active) return;
        latestCountRef.current = count;
        latestBoxesRef.current = boxes;
        setRawDetectedCount(count);
        setDetectedBoxes(boxes);
      } else if (
        role === 'controller' &&
        !localCameraActive &&
        !remoteStreamActive &&
        remoteFrameUrl &&
        remoteImgRef.current &&
        remoteImgRef.current.complete &&
        remoteImgRef.current.naturalWidth > 0
      ) {
        const { count, boxes } = await detectPersonsInElement(remoteImgRef.current, 0.4);
        if (active && count >= 0) {
          latestCountRef.current = count;
          latestBoxesRef.current = boxes;
          setRawDetectedCount(count);
          setDetectedBoxes(boxes);
        }
      }

      if (active) {
        timerId = window.setTimeout(detectionLoop, 380);
      }
    };

    timerId = window.setTimeout(detectionLoop, 400);
    return () => {
      active = false;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [visible, localCameraActive, remoteStreamActive, remoteFrameUrl, role]);

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

      const label = `PERSON · ${Math.round(item.score * 100)}%`;
      ctx.font = '600 12px Inter, sans-serif';
      const textW = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(20, 20, 26, 0.88)';
      ctx.fillRect(x, Math.max(0, y - 26), textW, 24);
      ctx.strokeStyle = '#36d67e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, Math.max(0, y - 26), textW, 24);
      ctx.fillStyle = '#36d67e';
      ctx.fillText(label, x + 7, Math.max(16, y - 9));
    }
  }, [detectedBoxes, localCameraActive, remoteStreamActive, remoteFrameUrl]);

  // Stabilize person count over 850ms so single-frame flicker never jerks the motors
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

  useEffect(() => {
    if (!serialConnected) return;
    const id = window.setInterval(() => {
      sendCommandToArduino(fan1Speed, fan2Speed, false);
    }, 2500);
    return () => window.clearInterval(id);
  }, [serialConnected, fan1Speed, fan2Speed, sendCommandToArduino]);

  const handleAdminPasswordChangeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPwdChangeError(null);
    setPwdChangeSuccess(null);

    if (!verifyAdminPassword(currentPwdInput)) {
      setPwdChangeError('Current password is incorrect.');
      return;
    }
    if (newPwdInput.trim().length < 4) {
      setPwdChangeError('New password must be at least 4 characters long.');
      return;
    }
    if (newPwdInput.trim() !== confirmPwdInput.trim()) {
      setPwdChangeError('New password and confirmation do not match.');
      return;
    }

    const updated = newPwdInput.trim();
    setStoredAdminPassword(updated);
    if (bcRef.current) {
      bcRef.current.postMessage({ type: 'admin:password_changed', newPassword: updated });
    }
    setCurrentPwdInput('');
    setNewPwdInput('');
    setConfirmPwdInput('');
    setPwdChangeSuccess('Controller password updated successfully!');
  };

  const workspaceRootRef = useRef<HTMLDivElement | null>(null);
  const workspaceStageRef = useRef<HTMLDivElement | null>(null);

  if (!visible) return null;

  const hasAnyVideoFeed = localCameraActive || remoteStreamActive || Boolean(remoteFrameUrl);

  const renderAnimatedTurbine = (speed: number, accentHex: string) => {
    const isSpinning = speed > 0;
    const duration = speed >= 100 ? '0.42s' : speed > 0 ? '0.92s' : '6.5s';
    return (
      <div className="relative w-9 h-9 flex items-center justify-center shrink-0">
        {isSpinning && (
          <span
            className="absolute inset-0 rounded-full animate-ping opacity-25"
            style={{ backgroundColor: accentHex }}
          />
        )}
        <svg
          viewBox="0 0 36 36"
          className={`w-8 h-8 rounded-full border border-white/15 p-1 animate-spin ${
            isSpinning ? 'opacity-100' : 'opacity-45'
          }`}
          style={{
            animationDuration: duration,
            color: isSpinning ? accentHex : '#b9aee8',
          }}
        >
          <circle cx="18" cy="18" r="3.2" fill="currentColor" />
          <path
            d="M18 4 C22 4, 23 11, 18 14 C15 11, 15 6, 18 4 Z"
            fill="currentColor"
          />
          <path
            d="M32 18 C32 22, 25 23, 22 18 C25 15, 30 15, 32 18 Z"
            fill="currentColor"
          />
          <path
            d="M18 32 C14 32, 13 25, 18 22 C21 25, 21 30, 18 32 Z"
            fill="currentColor"
          />
          <path
            d="M4 18 C4 14, 11 13, 14 18 C11 21, 6 21, 4 18 Z"
            fill="currentColor"
          />
        </svg>
      </div>
    );
  };

  return (
    <div
      ref={workspaceRootRef}
      data-testid="tejprakash-workspace"
      onPointerMove={(e) => {
        const w = window.innerWidth || 1440;
        const h = window.innerHeight || 960;
        const nx = (e.clientX / w - 0.5) * 2;
        const ny = (e.clientY / h - 0.5) * 2;
        if (workspaceRootRef.current) {
          workspaceRootRef.current.style.backgroundImage = `radial-gradient(560px circle at ${e.clientX}px ${e.clientY}px, rgba(185, 174, 232, 0.11), rgba(54, 214, 126, 0.05) 42%, transparent 75%), radial-gradient(circle at 50% 50%, rgba(5, 5, 7, 0.52) 0%, rgba(5, 5, 7, 0.14) 68%, transparent 100%)`;
        }
        if (workspaceStageRef.current) {
          workspaceStageRef.current.style.transform = `perspective(1600px) rotateX(${(-ny * 1.15).toFixed(2)}deg) rotateY(${(nx * 1.35).toFixed(2)}deg)`;
        }
      }}
      className="fixed inset-0 z-30 bg-transparent text-[#ededf0] overflow-y-auto select-text font-sans"
      style={{
        backgroundImage:
          'radial-gradient(560px circle at 50% 50%, rgba(185, 174, 232, 0.10), rgba(54, 214, 126, 0.05) 42%, transparent 75%), radial-gradient(circle at 50% 50%, rgba(5, 5, 7, 0.52) 0%, rgba(5, 5, 7, 0.14) 68%, transparent 100%)',
      }}
    >
      <div
        ref={workspaceStageRef}
        className="max-w-[1220px] mx-auto px-6 sm:px-14 py-6 sm:py-8 space-y-4 sm:space-y-5 transition-transform duration-150 ease-out will-change-transform"
      >
        {/* ====================================================================
         * TOP SMOKED-GLASS NAV SLAB (Mirrors the Landing Hero's Nav Slab)
         * ==================================================================== */}
        <header className={`${GLASS_SLAB_CLASS} px-5 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-4`}>
          {/* Iridescent top edge sheen */}
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#b9aee8]/40 to-transparent" />

          {/* Left: Square Facet Mark + Brand + Back Button */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              data-testid="workspace-back-btn"
              onClick={onBackToHero}
              className="px-3.5 py-2 rounded-[8px] bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.16] text-xs font-medium text-white/90 hover:text-[#b9aee8] cursor-pointer transition-all"
            >
              ← Back
            </button>

            <div className="h-4 w-[1px] bg-white/15 hidden sm:block" />

            <div className="flex items-center gap-2.5">
              {/* Square Facet Mark matching CanvasTextures.ts */}
              <div className="w-3.5 h-3.5 rounded-[3px] bg-white/92 relative overflow-hidden shrink-0">
                <div className="absolute inset-0 w-[1.5px] bg-[#141418] left-1/2 -translate-x-1/2 rotate-[22deg] scale-125" />
              </div>
              <span className="text-[15px] font-semibold tracking-[-0.02em] text-white/95">
                The Tejprakash
              </span>
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.14] text-[#36d67e]">
                {role === 'camera' ? 'CAMERA NODE' : 'CONTROLLER'}
              </span>
            </div>
          </div>

          {/* Right Action Pills */}
          <div className="flex flex-wrap items-center gap-2.5">
            {role === 'camera' ? (
              <button
                type="button"
                onClick={onRequestControllerLogin}
                className="px-4 py-2 rounded-[7px] bg-white/[0.08] hover:bg-[#36d67e]/20 border border-white/[0.24] hover:border-[#36d67e] text-xs font-medium text-white/90 hover:text-[#36d67e] cursor-pointer transition-all"
              >
                Controller Login →
              </button>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="pair-arduino-btn"
                  onClick={handleConnectSerial}
                  className={`px-4 py-2 rounded-[7px] text-xs font-medium cursor-pointer transition-all ${
                    serialConnected
                      ? 'bg-[#36d67e]/20 border border-[#36d67e] text-[#36d67e]'
                      : 'bg-[#ededf0] hover:bg-[#36d67e] text-[#09090c]'
                  }`}
                >
                  {serialConnected ? '● Arduino UNO Paired' : 'Pair Arduino USB'}
                </button>

                <button
                  type="button"
                  data-testid="open-arduino-code-btn"
                  onClick={() => setShowArduinoCodeModal(true)}
                  className="px-3.5 py-2 rounded-[7px] bg-white/[0.07] hover:bg-white/[0.14] border border-white/[0.18] text-xs font-medium text-white/90 cursor-pointer transition-all"
                >
                  Arduino Code (.ino)
                </button>

                <button
                  type="button"
                  data-testid="change-password-btn"
                  onClick={() => {
                    setPwdChangeError(null);
                    setPwdChangeSuccess(null);
                    setShowPasswordModal(true);
                  }}
                  className="px-3.5 py-2 rounded-[7px] bg-white/[0.07] hover:bg-[#b9aee8]/20 border border-white/[0.18] hover:border-[#b9aee8]/60 text-xs font-medium text-white/85 hover:text-[#dcd6f7] cursor-pointer transition-all"
                >
                  Change Password
                </button>
              </>
            )}
          </div>
        </header>

        {role === 'camera' ? (
          /* ====================================================================
           * VIEW 1: SMARTPHONE CAMERA NODE (Smoked-Glass Slab)
           * ==================================================================== */
          <div className="max-w-4xl mx-auto">
            <div className={`${GLASS_SLAB_CLASS} p-6 sm:p-8 space-y-6`}>
              <div className="pointer-events-none absolute inset-x-10 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#36d67e]/45 to-transparent" />

              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/40 block mb-2">
                    THE TEJPRAKASH · VISION SENSOR NODE
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-medium tracking-[-0.04em] bg-gradient-to-b from-[#dcdce0] to-[#bdbdc3] bg-clip-text text-transparent m-0">
                    Classroom Camera Stream.
                  </h2>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next = facingMode === 'environment' ? 'user' : 'environment';
                      setFacingMode(next);
                      startLocalCamera(next);
                    }}
                    className="px-4 py-2 rounded-[7px] bg-white/[0.07] hover:bg-white/[0.14] border border-white/[0.20] text-xs font-medium text-white/90 cursor-pointer transition-all"
                  >
                    Flip ({facingMode === 'environment' ? 'Rear' : 'Front'})
                  </button>

                  {localCameraActive ? (
                    <button
                      type="button"
                      onClick={stopLocalCamera}
                      className="px-4 py-2 rounded-[7px] bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/35 text-xs font-medium text-rose-200 cursor-pointer transition-all"
                    >
                      Pause Stream
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startLocalCamera(facingMode)}
                      className="px-4 py-2 rounded-[7px] bg-[#ededf0] hover:bg-[#36d67e] text-[#09090c] font-medium text-xs cursor-pointer transition-all"
                    >
                      Enable Camera
                    </button>
                  )}
                </div>
              </div>

              {/* Camera Viewport inside Recessed Glass Frame */}
              <div className="relative w-full aspect-video rounded-[16px] overflow-hidden bg-[#050507] border border-white/[0.12] shadow-[inset_0_2px_20px_rgba(0,0,0,0.9)] flex items-center justify-center">
                {/* Ambient Optical Grid, Sweeping Laser Beam & Corner Reticles */}
                <div
                  className="pointer-events-none absolute inset-0 opacity-20"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
                    backgroundSize: '36px 36px',
                  }}
                />
                <div className="tej-scan-beam pointer-events-none absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[#36d67e]/75 to-transparent shadow-[0_0_16px_rgba(54,214,126,0.75)]" />
                <div className="pointer-events-none absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-[#36d67e]/50 rounded-tl-[4px]" />
                <div className="pointer-events-none absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-[#36d67e]/50 rounded-tr-[4px]" />
                <div className="pointer-events-none absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-[#36d67e]/50 rounded-bl-[4px]" />
                <div className="pointer-events-none absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-[#36d67e]/50 rounded-br-[4px]" />

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
                  <div className="relative z-10 text-center p-6 max-w-md space-y-3">
                    <p className="text-sm text-white/75 font-normal leading-relaxed m-0">
                      Grant camera permission on this device to stream live classroom video and AI occupancy count directly to the Controller.
                    </p>
                    {cameraError && (
                      <p className="text-xs text-rose-400 m-0">{cameraError}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => startLocalCamera(facingMode)}
                      className="px-5 py-2.5 rounded-[7px] bg-[#ededf0] hover:bg-[#36d67e] text-[#09090c] font-medium text-xs cursor-pointer transition-all"
                    >
                      Grant Camera Permission
                    </button>
                  </div>
                )}

                {/* Glass HUD Pills */}
                <div className="absolute top-3.5 left-3.5 flex items-center gap-2 bg-[#141418]/85 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/[0.15]">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      localCameraActive ? 'bg-[#36d67e] animate-pulse' : 'bg-white/35'
                    }`}
                  />
                  <span className="text-[11px] font-medium text-white/90">
                    {localCameraActive ? 'Streaming Live to Controller' : 'Camera Standby'}
                  </span>
                </div>

                <div className="absolute top-3.5 right-3.5 bg-[#141418]/85 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-[#36d67e]/45">
                  <span className="text-xs font-medium text-[#36d67e]">
                    Occupancy: {rawDetectedCount} {rawDetectedCount === 1 ? 'Person' : 'Persons'}
                  </span>
                </div>
              </div>

              {/* Bottom Telemetry Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className={`${GLASS_SUBSLAB_CLASS} p-4`}>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-white/40 block">
                    AI VISION ENGINE
                  </span>
                  <span className="text-sm font-medium text-white/90 mt-1 block">
                    {aiModelLoading
                      ? 'Initializing COCO-SSD...'
                      : aiModelLoaded
                      ? 'Real-Time Person Detection'
                      : 'Ready'}
                  </span>
                </div>
                <div className={`${GLASS_SUBSLAB_CLASS} p-4 flex items-center justify-between`}>
                  <div>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/40 block">
                      FAN 1 · MOTOR 1 (OUT1/OUT2)
                    </span>
                    <span className="text-sm font-medium text-[#36d67e] mt-1 block">
                      {fan1Speed === 0 ? 'OFF (0%)' : `${fan1Speed}% Speed`}
                    </span>
                  </div>
                  {renderAnimatedTurbine(fan1Speed, '#36d67e')}
                </div>
                <div className={`${GLASS_SUBSLAB_CLASS} p-4 flex items-center justify-between`}>
                  <div>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/40 block">
                      FAN 2 · MOTOR 2 (OUT3/OUT4)
                    </span>
                    <span className="text-sm font-medium text-[#b9aee8] mt-1 block">
                      {fan2Speed === 0 ? 'OFF (0%)' : `${fan2Speed}% Speed`}
                    </span>
                  </div>
                  {renderAnimatedTurbine(fan2Speed, '#b9aee8')}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ====================================================================
           * VIEW 2: PASSWORD-PROTECTED SMOKED-GLASS CONTROLLER INTERIOR
           * Fractured into sculpted Smoked-Glass Shards/Slabs matching the Hero
           * ==================================================================== */
          <div className="space-y-4 sm:space-y-5">
            {/* Mode Switcher Smoked-Glass Slab ("Manually" vs "AI Model") */}
            <div className={`${GLASS_SLAB_CLASS} px-6 py-4 flex flex-wrap items-center justify-between gap-4`}>
              <div>
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40 block">
                  THE TEJPRAKASH · OPERATING ARCHITECTURE
                </span>
                <p className="text-sm text-white/75 m-0 mt-0.5 font-normal">
                  Live classroom vision is shared across both modes. Choose between direct human control or autonomous AI occupancy rules.
                </p>
              </div>

              {/* Exact Landing-Page Style Pill Switcher */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  data-testid="mode-btn-manual"
                  onClick={() => setControlMode('manual')}
                  className={`px-5 py-2.5 rounded-[7px] text-xs font-medium cursor-pointer transition-all ${
                    controlMode === 'manual'
                      ? 'bg-[#ededf0] text-[#09090c] shadow-[0_0_25px_rgba(255,255,255,0.18)]'
                      : 'bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.20] text-white/85'
                  }`}
                >
                  Manually
                </button>

                <button
                  type="button"
                  data-testid="mode-btn-ai"
                  onClick={() => setControlMode('ai')}
                  className={`px-5 py-2.5 rounded-[7px] text-xs font-medium cursor-pointer transition-all ${
                    controlMode === 'ai'
                      ? 'bg-[#36d67e] text-[#09090c] shadow-[0_0_25px_rgba(54,214,126,0.28)]'
                      : 'bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.20] text-white/85'
                  }`}
                >
                  AI Model
                </button>
              </div>
            </div>

            {/* Main Shard Grid: Left = Live Camera Vision Shard (7 cols), Right = Control Shards (5 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
              {/* LEFT SHARD (7 cols): Common Live Classroom Camera Feed */}
              <div className={`lg:col-span-7 ${GLASS_SLAB_CLASS} p-5 sm:p-6 flex flex-col justify-between`}>
                <div className="pointer-events-none absolute inset-x-10 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/25 to-transparent" />

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40 block">
                        COMMON CLASSROOM VISION FEED · {controlMode === 'ai' ? 'AI MODEL' : 'MANUAL MODE'}
                      </span>
                      <h2 className="text-xl font-medium tracking-[-0.03em] text-white/95 m-0 mt-0.5">
                        Live Camera Telemetry
                      </h2>
                    </div>

                    <div className="flex items-center gap-2">
                      {!localCameraActive ? (
                        <button
                          type="button"
                          data-testid="controller-start-cam-btn"
                          onClick={() => startLocalCamera('user')}
                          className="px-3.5 py-2 rounded-[7px] bg-white/[0.08] hover:bg-[#36d67e]/20 border border-white/[0.22] hover:border-[#36d67e] text-xs font-medium text-white/90 hover:text-[#36d67e] cursor-pointer transition-all"
                        >
                          Use Device Camera
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={stopLocalCamera}
                          className="px-3.5 py-2 rounded-[7px] bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/35 text-xs font-medium text-rose-200 cursor-pointer transition-all"
                        >
                          Stop Device Camera
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Video / Remote Stream Stage */}
                  <div className="relative w-full aspect-video rounded-[16px] overflow-hidden bg-[#050507] border border-white/[0.12] shadow-[inset_0_2px_24px_rgba(0,0,0,0.92)] flex items-center justify-center">
                    {/* Subtle Optical Sensor Grid, Sweeping Laser Beam & Corner Reticles */}
                    <div
                      className="pointer-events-none absolute inset-0 opacity-20"
                      style={{
                        backgroundImage:
                          'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
                        backgroundSize: '36px 36px',
                      }}
                    />
                    <div className="tej-scan-beam pointer-events-none absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[#36d67e]/75 to-transparent shadow-[0_0_16px_rgba(54,214,126,0.75)]" />
                    <div className="pointer-events-none absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-[#36d67e]/50 rounded-tl-[4px]" />
                    <div className="pointer-events-none absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-[#36d67e]/50 rounded-tr-[4px]" />
                    <div className="pointer-events-none absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-[#36d67e]/50 rounded-bl-[4px]" />
                    <div className="pointer-events-none absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-[#36d67e]/50 rounded-br-[4px]" />

                    <video
                      ref={localVideoRef}
                      playsInline
                      muted
                      autoPlay
                      className={`w-full h-full object-cover ${
                        localCameraActive ? 'block' : 'hidden'
                      }`}
                    />

                    <video
                      ref={remoteVideoRef}
                      playsInline
                      muted
                      autoPlay
                      className={`w-full h-full object-cover ${
                        !localCameraActive && remoteStreamActive ? 'block' : 'hidden'
                      }`}
                    />

                    {!localCameraActive && !remoteStreamActive && remoteFrameUrl && (
                      <img
                        ref={remoteImgRef}
                        src={remoteFrameUrl}
                        alt="Live Smartphone Classroom Feed"
                        className="w-full h-full object-cover block"
                      />
                    )}

                    <canvas
                      ref={overlayCanvasRef}
                      className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${
                        hasAnyVideoFeed ? 'block' : 'hidden'
                      }`}
                    />

                    {!hasAnyVideoFeed && (
                      <div className="relative z-10 text-center p-6 max-w-md space-y-3.5">
                        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.12] text-[11px] text-white/70">
                          <span className="w-2 h-2 rounded-full bg-[#b9aee8] animate-ping" />
                          Awaiting Smartphone Camera Node...
                        </div>
                        <p className="text-xs text-white/55 leading-relaxed m-0">
                          Open this website on your smartphone and tap <strong className="text-white/85">Camera</strong> to project live classroom video here—or enable this device&apos;s camera below.
                        </p>
                        {cameraError && (
                          <p className="text-xs text-rose-400 m-0">{cameraError}</p>
                        )}
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => startLocalCamera('user')}
                            className="px-5 py-2.5 rounded-[7px] bg-[#ededf0] hover:bg-[#36d67e] text-[#09090c] font-medium text-xs cursor-pointer transition-all"
                          >
                            Activate Camera Feed
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Top-Left Source Pill */}
                    <div className="absolute top-3.5 left-3.5 bg-[#141418]/85 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/[0.15] flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          hasAnyVideoFeed ? 'bg-[#36d67e] animate-pulse' : 'bg-white/35'
                        }`}
                      />
                      <span className="text-[11px] font-medium text-white/85">
                        {localCameraActive
                          ? 'Local Camera Vision'
                          : remoteCameraOnline || remoteFrameUrl
                          ? 'Smartphone Camera Stream'
                          : 'Vision Standby'}
                      </span>
                    </div>

                    {/* Top-Right Occupancy Pill */}
                    <div
                      data-testid="live-person-count-badge"
                      className="absolute top-3.5 right-3.5 bg-[#141418]/90 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-[#36d67e]/50"
                    >
                      <span className="text-xs font-medium text-[#36d67e]">
                        Detected: {effectivePersonCount} {effectivePersonCount === 1 ? 'Person' : 'Persons'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bottom Smoked-Glass Telemetry Sub-Slabs with Spinning SVG Turbine Visualizers */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                  <div className={`${GLASS_SUBSLAB_CLASS} p-3.5`}>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/40 block">
                      MODE
                    </span>
                    <span className="text-xs font-medium text-white/95 mt-1 block">
                      {controlMode === 'ai' ? 'AI Occupancy' : 'Manual Control'}
                    </span>
                    <div className="mt-2 h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#36d67e] to-[#b9aee8] transition-all duration-300"
                        style={{ width: controlMode === 'ai' ? '100%' : '55%' }}
                      />
                    </div>
                  </div>

                  <div className={`${GLASS_SUBSLAB_CLASS} p-3.5 flex items-center justify-between`}>
                    <div>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/40 block">
                        FAN 1 (D2/D3)
                      </span>
                      <span
                        data-testid="status-fan1-speed"
                        className="text-sm font-medium text-[#36d67e] mt-1 block"
                      >
                        {fan1Speed === 0 ? 'OFF (0%)' : `${fan1Speed}%`}
                      </span>
                      <div className="mt-1.5 h-1 w-16 rounded-full bg-white/[0.07] overflow-hidden">
                        <div
                          className="h-full bg-[#36d67e] transition-all duration-300"
                          style={{ width: `${fan1Speed}%` }}
                        />
                      </div>
                    </div>
                    {renderAnimatedTurbine(fan1Speed, '#36d67e')}
                  </div>

                  <div className={`${GLASS_SUBSLAB_CLASS} p-3.5 flex items-center justify-between`}>
                    <div>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/40 block">
                        FAN 2 (D4/D5)
                      </span>
                      <span
                        data-testid="status-fan2-speed"
                        className="text-sm font-medium text-[#b9aee8] mt-1 block"
                      >
                        {fan2Speed === 0 ? 'OFF (0%)' : `${fan2Speed}%`}
                      </span>
                      <div className="mt-1.5 h-1 w-16 rounded-full bg-white/[0.07] overflow-hidden">
                        <div
                          className="h-full bg-[#b9aee8] transition-all duration-300"
                          style={{ width: `${fan2Speed}%` }}
                        />
                      </div>
                    </div>
                    {renderAnimatedTurbine(fan2Speed, '#b9aee8')}
                  </div>

                  <div className={`${GLASS_SUBSLAB_CLASS} p-3.5`}>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/40 block">
                      SERIAL TX
                    </span>
                    <code className="text-xs font-mono text-white/85 mt-1 block">
                      {lastTxCommand}
                    </code>
                    <span className="text-[10px] text-[#36d67e]/80 mt-1 block">
                      ● 9600 Baud Live
                    </span>
                  </div>
                </div>
              </div>

              {/* RIGHT SHARDS (5 cols): Active Mode Control Slab + Hardware Link Slab */}
              <div className="lg:col-span-5 flex flex-col gap-4 sm:gap-5">
                {controlMode === 'manual' ? (
                  /* ----------------------------------------------------------------
                   * MANUALLY MODE SMOKED-GLASS SLAB
                   * ---------------------------------------------------------------- */
                  <div
                    data-testid="manual-control-panel"
                    className={`${GLASS_SLAB_CLASS} p-5 sm:p-6 space-y-5 flex-1`}
                  >
                    <div className="pointer-events-none absolute inset-x-10 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#b9aee8]/45 to-transparent" />

                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40 block">
                        MANUAL OPERATOR AUTHORITY
                      </span>
                      <h3 className="text-xl font-medium tracking-[-0.03em] text-white/95 m-0 mt-1">
                        Independent Dual-Fan Control
                      </h3>
                      <p className="text-xs text-white/55 m-0 mt-1 leading-relaxed">
                        Inspect the live classroom feed and set Fan 1 (Motor 1) and Fan 2 (Motor 2) speeds independently.
                      </p>
                    </div>

                    {/* FAN 1 (MOTOR 1) SUB-SLAB */}
                    <div className={`${GLASS_SUBSLAB_CLASS} p-4 space-y-3`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-medium text-white/95 block">
                            Fan 1 · Motor 1 (OUT1 &amp; OUT2)
                          </span>
                          <span className="text-[11px] text-white/40">
                            Pins: IN1 → D2 · IN2 → D3 (Hardware PWM)
                          </span>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${
                            fan1Speed > 0
                              ? 'bg-[#36d67e]/15 text-[#36d67e] border border-[#36d67e]/40'
                              : 'bg-white/[0.04] text-white/45 border border-white/10'
                          }`}
                        >
                          {fan1Speed === 0 ? 'OFF (0%)' : `${fan1Speed}% Speed`}
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
                            className={`py-2.5 rounded-[7px] text-xs font-medium cursor-pointer border transition-all ${
                              fan1Speed === btn.val
                                ? 'bg-[#ededf0] text-[#09090c] border-white'
                                : 'bg-white/[0.04] hover:bg-white/[0.10] text-white/80 border-white/[0.12]'
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* FAN 2 (MOTOR 2) SUB-SLAB */}
                    <div className={`${GLASS_SUBSLAB_CLASS} p-4 space-y-3`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-medium text-white/95 block">
                            Fan 2 · Motor 2 (OUT3 &amp; OUT4)
                          </span>
                          <span className="text-[11px] text-white/40">
                            Pins: IN3 → D4 · IN4 → D5 (Hardware PWM)
                          </span>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${
                            fan2Speed > 0
                              ? 'bg-[#b9aee8]/15 text-[#b9aee8] border border-[#b9aee8]/40'
                              : 'bg-white/[0.04] text-white/45 border border-white/10'
                          }`}
                        >
                          {fan2Speed === 0 ? 'OFF (0%)' : `${fan2Speed}% Speed`}
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
                            className={`py-2.5 rounded-[7px] text-xs font-medium cursor-pointer border transition-all ${
                              fan2Speed === btn.val
                                ? 'bg-[#ededf0] text-[#09090c] border-white'
                                : 'bg-white/[0.04] hover:bg-white/[0.10] text-white/80 border-white/[0.12]'
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Direct Combination Presets */}
                    <div className="space-y-2 pt-1">
                      <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40 block">
                        DIRECT COMBINATIONS
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          data-testid="only-fan1-btn"
                          onClick={() => applyManualFanChange(100, 0)}
                          className="py-2.5 px-3 rounded-[7px] bg-white/[0.05] hover:bg-[#36d67e]/20 border border-white/[0.14] hover:border-[#36d67e] text-xs font-medium text-white/90 hover:text-[#36d67e] cursor-pointer transition-all"
                        >
                          Only Fan 1 ON
                        </button>
                        <button
                          type="button"
                          data-testid="only-fan2-btn"
                          onClick={() => applyManualFanChange(0, 100)}
                          className="py-2.5 px-3 rounded-[7px] bg-white/[0.05] hover:bg-[#b9aee8]/20 border border-white/[0.14] hover:border-[#b9aee8] text-xs font-medium text-white/90 hover:text-[#dcd6f7] cursor-pointer transition-all"
                        >
                          Only Fan 2 ON
                        </button>
                        <button
                          type="button"
                          data-testid="both-fans-on-btn"
                          onClick={() => applyManualFanChange(100, 100)}
                          className="py-2.5 px-3 rounded-[7px] bg-white/[0.05] hover:bg-white/[0.14] border border-white/[0.14] text-xs font-medium text-white/90 cursor-pointer transition-all"
                        >
                          Both Fans ON (100%)
                        </button>
                        <button
                          type="button"
                          data-testid="both-fans-off-btn"
                          onClick={() => applyManualFanChange(0, 0)}
                          className="py-2.5 px-3 rounded-[7px] bg-white/[0.05] hover:bg-rose-500/20 border border-white/[0.14] hover:border-rose-400/40 text-xs font-medium text-white/75 hover:text-rose-200 cursor-pointer transition-all"
                        >
                          All Fans OFF (0%)
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ----------------------------------------------------------------
                   * AI MODEL MODE SMOKED-GLASS SLAB
                   * ---------------------------------------------------------------- */
                  <div
                    data-testid="ai-control-panel"
                    className={`${GLASS_SLAB_CLASS} p-5 sm:p-6 space-y-4 flex-1`}
                  >
                    <div className="pointer-events-none absolute inset-x-10 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#36d67e]/45 to-transparent" />

                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40 block">
                        AUTONOMOUS AI MODEL
                      </span>
                      <h3 className="text-xl font-medium tracking-[-0.03em] text-white/95 m-0 mt-1">
                        Occupancy Speed Matrix
                      </h3>
                      <p className="text-xs text-white/55 m-0 mt-1 leading-relaxed">
                        Classroom headcount automatically scales Motor 1 and Motor 2 speed to eliminate electrical waste.
                      </p>
                    </div>

                    {/* Active AI Decision Sub-Slab */}
                    <div className={`${GLASS_SUBSLAB_CLASS} p-4 border-[#36d67e]/35`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-[#36d67e]">
                          {currentAiDecision.ruleTitle}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.14em] px-2.5 py-0.5 rounded-full bg-white/[0.06] text-white/75">
                          {aiCountOverride === null ? 'Live Vision AI' : 'Simulation'}
                        </span>
                      </div>
                      <p className="text-xs text-white/75 m-0 leading-relaxed">
                        {currentAiDecision.ruleDescription}
                      </p>
                    </div>

                    {/* 5 Predefined Parameters Matrix */}
                    <div className="space-y-1.5">
                      {[
                        { count: 0, title: '0 Persons', desc: 'Fan 1: OFF · Fan 2: OFF' },
                        { count: 1, title: '1 Person', desc: 'Fan 1: 50% · Fan 2: OFF' },
                        { count: 2, title: '2 Persons', desc: 'Fan 1: 100% · Fan 2: OFF' },
                        { count: 3, title: '3 Persons', desc: 'Fan 1: 50% · Fan 2: 50%' },
                        { count: 4, title: '4+ Persons', desc: 'Fan 1: 100% · Fan 2: 100%' },
                      ].map((rule) => {
                        const isCurrent =
                          rule.count === 4
                            ? effectivePersonCount >= 4
                            : effectivePersonCount === rule.count;
                        return (
                          <div
                            key={rule.count}
                            className={`flex items-center justify-between px-3.5 py-2.5 rounded-[10px] border text-xs transition-all ${
                              isCurrent
                                ? 'bg-white/[0.10] border-[#36d67e]/60 text-white font-medium shadow-[0_0_20px_rgba(54,214,126,0.12)]'
                                : 'bg-[#0a0a0e]/80 border-white/[0.06] text-white/50'
                            }`}
                          >
                            <span>{rule.title}</span>
                            <span className={isCurrent ? 'text-[#36d67e]' : ''}>{rule.desc}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Occupancy Simulation / Live Camera Selector */}
                    <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-white/50">
                          Occupancy Source:
                        </span>
                        <button
                          type="button"
                          onClick={() => setAiCountOverride(null)}
                          className={`px-3 py-1 rounded-[6px] text-[11px] font-medium cursor-pointer transition-all ${
                            aiCountOverride === null
                              ? 'bg-[#ededf0] text-[#09090c]'
                              : 'bg-white/[0.06] text-white/70 hover:text-white'
                          }`}
                        >
                          Live Camera AI ({rawDetectedCount})
                        </button>
                      </div>

                      <div className="grid grid-cols-5 gap-1.5">
                        {[0, 1, 2, 3, 4].map((num) => (
                          <button
                            key={num}
                            type="button"
                            data-testid={`ai-sim-count-${num}`}
                            onClick={() => setAiCountOverride(num)}
                            className={`py-2 rounded-[7px] text-xs font-medium cursor-pointer border transition-all ${
                              aiCountOverride === num
                                ? 'bg-[#36d67e] text-[#09090c] border-[#36d67e]'
                                : 'bg-white/[0.04] hover:bg-white/[0.10] text-white/75 border-white/[0.10]'
                            }`}
                          >
                            {num === 4 ? '4+' : `${num}P`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Arduino UNO & L298N Hardware Telemetry Slab */}
                <div className={`${GLASS_SLAB_CLASS} p-4 sm:p-5 space-y-2.5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
                      ARDUINO UNO SMD · L298N BRIDGE
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        serialConnected ? 'text-[#36d67e]' : 'text-white/55'
                      }`}
                    >
                      {serialStatus}
                    </span>
                  </div>
                  <div className={`${GLASS_SUBSLAB_CLASS} px-3.5 py-2.5 text-[11px] text-white/55 flex flex-wrap items-center justify-between gap-2`}>
                    <span>D2→IN1 · D3(PWM)→IN2 · D4→IN3 · D5(PWM)→IN4</span>
                    <span className="font-mono text-[#36d67e]">RX: {lastArduinoReply}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ====================================================================
       * MODAL 1: CHANGE ADMIN PASSWORD (Smoked-Glass Slab)
       * ==================================================================== */}
      {showPasswordModal && (
        <div
          data-testid="change-password-modal"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div className={`${GLASS_SLAB_CLASS} w-full max-w-md p-6 sm:p-7 space-y-5`}>
            <div className="pointer-events-none absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#b9aee8]/50 to-transparent" />

            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40 block">
                  SECURITY CREDENTIALS
                </span>
                <h3 className="text-lg font-medium text-white/95 m-0 mt-0.5">
                  Change Controller Password
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPasswordModal(false)}
                className="px-2.5 py-1 rounded-[6px] bg-white/[0.06] hover:bg-white/[0.12] text-xs text-white/70 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAdminPasswordChangeSubmit} className="space-y-3.5">
              <div>
                <label className="block text-[11px] text-white/60 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  data-testid="current-password-input"
                  value={currentPwdInput}
                  onChange={(e) => setCurrentPwdInput(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-[#09090d] border border-white/[0.14] text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#b9aee8]"
                />
              </div>

              <div>
                <label className="block text-[11px] text-white/60 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  data-testid="new-password-input"
                  value={newPwdInput}
                  onChange={(e) => setNewPwdInput(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-[#09090d] border border-white/[0.14] text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#36d67e]"
                />
              </div>

              <div>
                <label className="block text-[11px] text-white/60 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  data-testid="confirm-password-input"
                  value={confirmPwdInput}
                  onChange={(e) => setConfirmPwdInput(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-[#09090d] border border-white/[0.14] text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#36d67e]"
                />
              </div>

              {pwdChangeError && (
                <p className="text-xs text-rose-400 m-0">{pwdChangeError}</p>
              )}
              {pwdChangeSuccess && (
                <p className="text-xs text-[#36d67e] m-0">{pwdChangeSuccess}</p>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 rounded-[7px] bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.14] text-xs font-medium text-white/80 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="save-new-password-btn"
                  className="px-5 py-2 rounded-[7px] bg-[#ededf0] hover:bg-[#36d67e] text-[#09090c] font-medium text-xs cursor-pointer transition-all"
                >
                  Save New Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
       * MODAL 2: ARDUINO IDE (.ino) FIRMWARE CODE
       * ==================================================================== */}
      {showArduinoCodeModal && (
        <div
          data-testid="arduino-code-modal"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div className={`${GLASS_SLAB_CLASS} w-full max-w-3xl max-h-[86vh] flex flex-col overflow-hidden`}>
            <div className="px-6 py-4 border-b border-white/[0.10] flex items-center justify-between">
              <div>
                <h3 className="text-base font-medium text-white/95 m-0">
                  tejprakash_arduino.ino — Arduino UNO SMD Firmware
                </h3>
                <p className="text-xs text-white/50 m-0 mt-0.5">
                  Uses D2, D3 (PWM), D4, D5 (PWM) with soft-start ramp to prevent 12V 1A adapter overload.
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
                  className="px-4 py-2 rounded-[7px] bg-[#ededf0] hover:bg-[#36d67e] text-[#09090c] font-medium text-xs cursor-pointer transition-all"
                >
                  {copiedCode ? '✓ Copied' : 'Copy .ino Code'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowArduinoCodeModal(false)}
                  className="px-3 py-2 rounded-[7px] bg-white/[0.07] hover:bg-white/[0.14] text-xs text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            <pre className="p-5 text-xs font-mono text-[#36d67e]/90 overflow-y-auto flex-1 m-0 leading-relaxed bg-[#07070a]">
              {ARDUINO_INO_CODE}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
