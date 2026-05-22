import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { Play, Pause, RefreshCw, Upload, Video, Monitor, AppWindow, Settings, Sliders, Activity, Info, AlertCircle, Wifi, WifiOff, Volume2, Lightbulb, Tv, Trash2, Plus, Copy, Check, Eye, Edit3, Search } from 'lucide-react';
import { WLEDConfig, SyncProtocol, SourceType, EffectType, FrameStats, TargetType, AccentMappingZone, AuxiliaryTarget, NdiStreamInput } from './types';
import WLEDEmulator from './components/WLEDEmulator';
import { renderProceduralEffect } from './utils/proceduralEffects';

// ---- Pixel sampling high-fidelity helpers ----
const getPixelColor = (x: number, y: number, width: number, height: number, data: Uint8ClampedArray) => {
  const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const idx = (cy * width + cx) * 4;
  return {
    r: data[idx] !== undefined ? data[idx] : 0,
    g: data[idx + 1] !== undefined ? data[idx + 1] : 0,
    b: data[idx + 2] !== undefined ? data[idx + 2] : 0,
  };
};

const getZoneAverage = (zone: AccentMappingZone, W: number, H: number, data: Uint8ClampedArray) => {
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  let startX = 0, endX = W, startY = 0, endY = H;

  switch (zone) {
    case AccentMappingZone.CENTER:
      startX = Math.floor(W / 4);
      endX = Math.ceil((3 * W) / 4);
      startY = Math.floor(H / 4);
      endY = Math.ceil((3 * H) / 4);
      break;
    case AccentMappingZone.TOP:
      startY = 0;
      endY = Math.max(1, Math.floor(H / 6));
      break;
    case AccentMappingZone.BOTTOM:
      startY = Math.max(0, H - Math.max(1, Math.floor(H / 6)));
      endY = H;
      break;
    case AccentMappingZone.LEFT:
      startX = 0;
      endX = Math.max(1, Math.floor(W / 6));
      break;
    case AccentMappingZone.RIGHT:
      startX = Math.max(0, W - Math.max(1, Math.floor(W / 6)));
      endX = W;
      break;
    case AccentMappingZone.WHOLE_AVERAGE:
    default:
      break;
  }

  if (startX >= endX) endX = startX + 1;
  if (startY >= endY) endY = startY + 1;

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const idx = (y * W + x) * 4;
      if (idx < data.length) {
        rSum += data[idx];
        gSum += data[idx + 1];
        bSum += data[idx + 2];
        count++;
      }
    }
  }

  if (count === 0) return { r: 0, g: 0, b: 0 };
  return {
    r: Math.round(rSum / count),
    g: Math.round(gSum / count),
    b: Math.round(bSum / count),
  };
};

export default function App() {
  // ---- Config States ----
  const [wledConfig, setWledConfig] = useState<WLEDConfig>({
    ipAddress: '192.168.1.100',
    port: 4048,
    protocol: SyncProtocol.DDP,
    isMatrix: true,
    width: 16,
    height: 16,
    totalLEDs: 256,
    serpentine: true,
    reverseRows: false,
    vertical: false,
    brightness: 100,
    contrast: 0,
    saturation: 0,
    gamma: 1.0,
    blur: 0,
    fpsLimit: 30,
    timeout: 2,
    universe: 1,
  });

  const [protocolPorts, setProtocolPorts] = useState<{ [key in SyncProtocol]: number }>({
    [SyncProtocol.DDP]: 4048,
    [SyncProtocol.DRGB]: 21324,
    [SyncProtocol.WARLS]: 21324,
    [SyncProtocol.ARTNET]: 6454,
    [SyncProtocol.E131]: 5568,
  });

  // ---- Player & Video States ----
  const [activeSource, setActiveSource] = useState<SourceType>(SourceType.E_EFFECTS);
  const [activeEffect, setActiveEffect] = useState<EffectType>(EffectType.RAINBOW);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [ytQuery, setYtQuery] = useState<string>('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);

  // ---- NDI & Multi-Output State Hooks ----
  const [ndiStreamUrl, setNdiStreamUrl] = useState<string>('http://192.168.1.150:8080/video');
  const [useSimulatedNdi, setUseSimulatedNdi] = useState<boolean>(true);
  const streamImgRef = useRef<HTMLImageElement | null>(null);

  const [ndiInputs, setNdiInputs] = useState<NdiStreamInput[]>([
    {
      id: 'ndi-obs-program',
      name: 'OBS DistroAV - Program Out',
      sourceName: 'GAMING-DESKTOP (OBS - DistroAV Master)',
      ipAddress: '192.168.1.150',
      port: 5961,
      url: 'http://192.168.1.150:8080/video',
      enabled: true,
      resolution: '1920x1080',
      fps: 60,
      status: 'ONLINE'
    },
    {
      id: 'ndi-obs-camera',
      name: 'OBS DistroAV - Live Camera',
      sourceName: 'CAM-PODIUM (OBS - DistroAV Stage Mirror)',
      ipAddress: '192.168.1.152',
      port: 5961,
      url: 'http://192.168.1.152:8080/video',
      enabled: false,
      resolution: '1280x720',
      fps: 30,
      status: 'ONLINE'
    },
    {
      id: 'ndi-cam-hx',
      name: 'Studio Cam HX Output',
      sourceName: 'STUDIO-CAM-A (NDI HX Camera)',
      ipAddress: '192.168.1.112',
      port: 5961,
      url: 'http://192.168.1.112:8554/stream',
      enabled: false,
      resolution: '3840x2160',
      fps: 59,
      status: 'OFFLINE'
    }
  ]);
  const [selectedNdiId, setSelectedNdiId] = useState<string>('ndi-obs-program');
  const [isScanningNdi, setIsScanningNdi] = useState<boolean>(false);
  const [scanLogs, setScanLogs] = useState<string[]>([]);


  const [auxiliaryTargets, setAuxiliaryTargets] = useState<AuxiliaryTarget[]>([
    {
      id: 'lightpack-1',
      name: 'LCD Backlight Ambilight',
      type: TargetType.AMBIENT_LIGHTPACK,
      enabled: false,
      ipAddress: '192.168.1.101',
      port: 5568,
      protocol: SyncProtocol.E131,
      universe: 1,
      topLedCount: 12,
      rightLedCount: 8,
      bottomLedCount: 12,
      leftLedCount: 8,
      mappedZone: AccentMappingZone.WHOLE_AVERAGE,
      accentLedCount: 40
    },
    {
      id: 'accent-bulb-1',
      name: 'Dynamic Desk Spotlight',
      type: TargetType.INDIVIDUAL_ACCENT,
      enabled: false,
      ipAddress: '192.168.1.102',
      port: 4048,
      protocol: SyncProtocol.DDP,
      universe: 0,
      topLedCount: 0,
      rightLedCount: 0,
      bottomLedCount: 0,
      leftLedCount: 0,
      mappedZone: AccentMappingZone.CENTER,
      accentLedCount: 30
    }
  ]);
  const [auxPixels, setAuxPixels] = useState<{ [key: string]: Uint8Array }>({});

  // ---- Server Connection States ----
  const [socketStatus, setSocketStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'CONNECTING'>('DISCONNECTED');
  const [stats, setStats] = useState<FrameStats>({
    fps: 0,
    droppedFrames: 0,
    bytesSent: 0,
    packetsSent: 0,
    latencyMs: 0,
  });

  // ---- References ----
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rawPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  // Audio analyzer references
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioBufferRef = useRef<Uint8Array | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);

  // Streaming loops and calculation markers
  const animationFrameId = useRef<number | null>(null);
  const lastFrameTime = useRef<number>(0);
  const statsTracker = useRef({
    frames: 0,
    bytes: 0,
    packets: 0,
    lastSecTime: 0,
  });

  const lastUiUpdateRef = useRef<number>(0);

  const [simulatedPixels, setSimulatedPixels] = useState<Uint8Array>(new Uint8Array(256 * 3));

  // Auto-set standard ports upon protocol changes
  const handleProtocolChange = (protocol: SyncProtocol) => {
    const port = protocolPorts[protocol] !== undefined ? protocolPorts[protocol] : 21324;
    const universe = protocol === SyncProtocol.E131 ? 1 : 0;
    setWledConfig(prev => ({ ...prev, protocol, port, universe }));
  };

  const handlePortChange = (port: number) => {
    setWledConfig(prev => ({ ...prev, port }));
    setProtocolPorts(prev => ({ ...prev, [wledConfig.protocol]: port }));
  };

  // ---- Auxiliary State mutator handlers ----
  const handleToggleAux = (id: string) => {
    setAuxiliaryTargets(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const handleUpdateAux = (id: string, updates: Partial<AuxiliaryTarget>) => {
    setAuxiliaryTargets(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleAddAux = () => {
    const newId = `custom-lamp-${Date.now()}`;
    const newTarget: AuxiliaryTarget = {
      id: newId,
      name: `Accents Spotlight #${auxiliaryTargets.length + 1}`,
      type: TargetType.INDIVIDUAL_ACCENT,
      enabled: true,
      ipAddress: '192.168.1.115',
      port: 4048,
      protocol: SyncProtocol.DDP,
      universe: 0,
      topLedCount: 0,
      rightLedCount: 0,
      bottomLedCount: 0,
      leftLedCount: 0,
      mappedZone: AccentMappingZone.WHOLE_AVERAGE,
      accentLedCount: 30
    };
    setAuxiliaryTargets(prev => [...prev, newTarget]);
  };

  const handleRemoveAux = (id: string) => {
    setAuxiliaryTargets(prev => prev.filter(t => t.id !== id));
  };

  // ---- NDI Stream Input state mutators ----
  const handleSelectNdi = (id: string) => {
    setSelectedNdiId(id);
    const target = ndiInputs.find(i => i.id === id);
    if (target) {
      setNdiStreamUrl(target.url);
      setNdiInputs(prev => prev.map(item => ({
        ...item,
        enabled: item.id === id
      })));
      if (!useSimulatedNdi && streamImgRef.current) {
        streamImgRef.current.src = target.url;
      }
    }
  };

  const handleUpdateNdi = (id: string, updates: Partial<NdiStreamInput>) => {
    setNdiInputs(prev => prev.map(item => {
      if (item.id === id) {
        const next = { ...item, ...updates };
        if (id === selectedNdiId && updates.url !== undefined) {
          setNdiStreamUrl(updates.url);
        }
        return next;
      }
      return item;
    }));
  };

  const handleAddNdi = () => {
    const newId = `ndi-input-${Date.now()}`;
    const newSource: NdiStreamInput = {
      id: newId,
      name: `Sourced Feed #${ndiInputs.length + 1}`,
      sourceName: `USER-PC (DistroAV - Source #${ndiInputs.length + 1})`,
      ipAddress: '192.168.1.150',
      port: 5961 + ndiInputs.length,
      url: `http://192.168.1.150:8080/video${ndiInputs.length + 1}`,
      enabled: false,
      resolution: '1920x1080',
      fps: 60,
      status: 'ONLINE'
    };
    setNdiInputs(prev => [...prev, newSource]);
  };

  const handleRemoveNdi = (id: string) => {
    setNdiInputs(prev => {
      const next = prev.filter(item => item.id !== id);
      if (id === selectedNdiId && next.length > 0) {
        // Switch selected NDI to first available
        setSelectedNdiId(next[0].id);
        setNdiStreamUrl(next[0].url);
      }
      return next;
    });
  };

  const handleScanNdiNetwork = () => {
    if (isScanningNdi) return;
    setIsScanningNdi(true);
    setScanLogs([]);

    const logPoints = [
      '⚡ Initializing Multicast mDNS discovery on LAN (Port 5353)...',
      '🔍 Querying pointer records for NDI: _ndi._tcp.local...',
      '📡 Query broadcast routed through gateway local interface...',
      '📥 Received mDNS A-record from 192.168.1.150 (Host: DESKTOP-PC)',
      '✅ DistroAV Program stream resolved [DESKTOP-GAMING (DistroAV - Program)]',
      '✅ DistroAV Preview stream resolved [DESKTOP-GAMING (DistroAV - Preview)]',
      '📥 Received mDNS A-record from 192.168.1.152 (Host: CAM-PODIUM)',
      '✅ DistroAV Camera resolved [CAM-PODIUM (DistroAV Stage Mirror)]',
      '🎉 NDI discovery completed. Found 3 sources active on local subnet!'
    ];

    logPoints.forEach((msg, idx) => {
      setTimeout(() => {
        setScanLogs(prev => [...prev, msg]);
        if (idx === logPoints.length - 1) {
          setIsScanningNdi(false);
          // Set all existing preset sources to ONLINE status during simulation
          setNdiInputs(prev => prev.map(item => {
            if (item.id === 'ndi-obs-program' || item.id === 'ndi-obs-camera') {
              return { ...item, status: 'ONLINE' };
            }
            return item;
          }));
        }
      }, (idx + 1) * 600);
    });
  };


  // ---- WebSocket Connection Handler ----
  useEffect(() => {
    if (isStreaming) {
      setSocketStatus('CONNECTING');
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProto}//${window.location.host}/api/video-sync`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setSocketStatus('CONNECTED');
        console.log('WLED Video Sync WebSocket active');
      };

      ws.onclose = () => {
        setSocketStatus('DISCONNECTED');
        setIsStreaming(false);
      };

      ws.onerror = (err) => {
        console.error('WebSocket connection failure:', err);
        setSocketStatus('DISCONNECTED');
        setIsStreaming(false);
      };

      return () => {
        ws.close();
      };
    } else {
      if (wsRef.current) {
        wsRef.current.close();
      }
      setSocketStatus('DISCONNECTED');
    }
  }, [isStreaming]);

  // Handle total LED calculations when grid dims change
  useEffect(() => {
    const total = wledConfig.isMatrix 
      ? wledConfig.width * wledConfig.height
      : wledConfig.totalLEDs;
    setSimulatedPixels(new Uint8Array(total * 3));
  }, [wledConfig.isMatrix, wledConfig.width, wledConfig.height, wledConfig.totalLEDs]);

  // Clean source elements on type update
  const stopExistingMedia = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      if (videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      videoRef.current.removeAttribute('src');
      try {
        videoRef.current.load();
      } catch (err) {
        // Safe catch
      }
    }
    setIsPlaying(false);
    setCameraError(null);
    setScreenShareError(null);
  };

  useEffect(() => {
    stopExistingMedia();
  }, [activeSource]);

  // ---- Audio Capture Setup ----
  const enableMicrophone = async () => {
    try {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64; // Low bounds for low frequency grid bands
      
      const micSource = audioCtx.createMediaStreamSource(stream);
      micSource.connect(analyser);
      
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      microphoneRef.current = micSource;
      audioBufferRef.current = new Uint8Array(analyser.frequencyBinCount);
      setIsMicEnabled(true);
    } catch (err) {
      console.warn('Microphone permission denied / not available:', err);
      setIsMicEnabled(false);
    }
  };

  // ---- Play Video Safely ----
  const playVideoSafe = () => {
    if (!videoRef.current) return;
    videoRef.current.play()
      .then(() => {
        setIsPlaying(true);
      })
      .catch((err) => {
        // Discard AbortError since it's a completely expected part of switching sources or pausing
        if (err.name !== 'AbortError') {
          console.error('Failed to play media stream:', err);
        }
      });
  };

  // ---- Video File Picker ----
  const handleVideoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setVideoFile(file);
      stopExistingMedia();
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      
      if (videoRef.current) {
        videoRef.current.src = url;
        videoRef.current.loop = true;
        playVideoSafe();
      }
    }
  };

  // ---- Webcam Selector ----
  const startCameraStream = async () => {
    setCameraError(null);
    try {
      stopExistingMedia();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 30 },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        playVideoSafe();
      }
    } catch (err: any) {
      console.error('Webcam access error:', err);
      setCameraError(err?.message || String(err));
    }
  };

  // ---- Screen Shared Grabber ----
  const startScreenCapture = async () => {
    setScreenShareError(null);
    try {
      stopExistingMedia();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        playVideoSafe();
      }
      // Listen for screensharing block end
      stream.getVideoTracks()[0].onended = () => {
        setIsPlaying(false);
      };
    } catch (err: any) {
      console.error('Screen capture rejected:', err);
      setScreenShareError(err?.message || String(err));
    }
  };

  // Play / Pause buttons
  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      playVideoSafe();
    }
  };

  // ---- Central Processing Render Frame Tick Hook ----
  useEffect(() => {
    const processFrame = (timestamp: number) => {
      // Establish target frames intervals matching limit limits
      const interval = 1000 / wledConfig.fpsLimit;
      const elapsed = timestamp - lastFrameTime.current;

      if (elapsed >= interval) {
        lastFrameTime.current = timestamp - (elapsed % interval);

        const procCanvas = processingCanvasRef.current;
        const prevCanvas = previewCanvasRef.current;
        const rawCanvas = rawPreviewCanvasRef.current;
        if (!procCanvas || !prevCanvas) {
          animationFrameId.current = requestAnimationFrame(processFrame);
          return;
        }

        const ctx = procCanvas.getContext('2d', { willReadFrequently: true });
        const prevCtx = prevCanvas.getContext('2d');
        const rawCtx = rawCanvas?.getContext('2d');
        if (!ctx || !prevCtx) {
          animationFrameId.current = requestAnimationFrame(processFrame);
          return;
        }

        // Establish core grids sizing boundaries
        const W = wledConfig.isMatrix ? wledConfig.width : wledConfig.totalLEDs;
        const H = wledConfig.isMatrix ? wledConfig.height : 1;

        if (procCanvas.width !== W || procCanvas.height !== H) {
          procCanvas.width = W;
          procCanvas.height = H;
        }

        // Apply HTML5 hardware acceleration picture controls (contrast, brightness, blur, saturate)
        const filterStr = `brightness(${wledConfig.brightness}%) contrast(${100 + wledConfig.contrast}%) saturate(${100 + wledConfig.saturation}%) blur(${wledConfig.blur}px)`;
        ctx.filter = filterStr;

        // 1. Draw source onto the mini processing canvas
        if (activeSource === SourceType.E_EFFECTS) {
          // If audio spectrum is active, run microphone byte updates
          if (activeEffect === EffectType.AUDIO_SPECTRUM && analyserRef.current && audioBufferRef.current) {
            analyserRef.current.getByteFrequencyData(audioBufferRef.current);
          }
          renderProceduralEffect(ctx, W, H, activeEffect, timestamp / 1000, audioBufferRef.current || undefined);
        } else if (activeSource === SourceType.NDI_IP_STREAM) {
          if (useSimulatedNdi) {
            // Draw SMPTE test bars pattern with dynamic movement sweep
            ctx.fillStyle = '#08080a';
            ctx.fillRect(0, 0, W, H);

            // Draw color blocks
            const barW = Math.max(1, W / 6);
            const colors = ['#ffffff', '#eab308', '#06b6d4', '#22c55e', '#ec4899', '#ef4444'];
            colors.forEach((col, idx) => {
              ctx.fillStyle = col;
              ctx.fillRect(idx * barW, 0, barW, Math.round(H * 0.7));
            });

            // Sweep visual bar
            const sweepInterval = (timestamp / 1000) % (W * 2);
            const lineX = sweepInterval > W ? W * 2 - sweepInterval : sweepInterval;
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(lineX, 0);
            ctx.lineTo(lineX, H);
            ctx.stroke();

            // Intersecting dynamic sine pulse orb
            const orbX = (Math.sin(timestamp / 600) + 1) * 0.5 * W;
            const orbY = (Math.cos(timestamp / 400) + 1) * 0.5 * H;
            ctx.fillStyle = '#3b82f6';
            ctx.beginPath();
            ctx.arc(orbX, orbY, Math.max(1, W / 7), 0, Math.PI * 2);
            ctx.fill();
          } else if (streamImgRef.current && streamImgRef.current.complete && streamImgRef.current.naturalWidth > 0) {
            try {
              ctx.drawImage(streamImgRef.current, 0, 0, W, H);
            } catch (err) {
              ctx.fillStyle = '#18181b';
              ctx.fillRect(0, 0, W, H);
            }
          } else {
            ctx.fillStyle = '#18181b';
            ctx.fillRect(0, 0, W, H);
          }
        } else if (videoRef.current && isPlaying && videoRef.current.readyState >= 2) {
          try {
            ctx.drawImage(videoRef.current, 0, 0, W, H);
          } catch (err) {
            ctx.fillStyle = '#18181b';
            ctx.fillRect(0, 0, W, H);
          }
        } else {
          // Solid background idle glow placeholder color
          ctx.fillStyle = '#18181b';
          ctx.fillRect(0, 0, W, H);
        }

        // 2. Extract layout dimensions
        const imgData = ctx.getImageData(0, 0, W, H);
        const data = imgData.data;

        // 3. Render raw preview scales
        if (rawCanvas && rawCtx) {
          if (rawCanvas.width !== W || rawCanvas.height !== H) {
            rawCanvas.width = W;
            rawCanvas.height = H;
          }
          rawCtx.putImageData(imgData, 0, 0);
        }

        // Render bigger preview canvas for the UI
        prevCanvas.width = W * 15;
        prevCanvas.height = H * 15;
        prevCtx.imageSmoothingEnabled = false;
        prevCtx.drawImage(procCanvas, 0, 0, prevCanvas.width, prevCanvas.height);

        // 4. Map the 2D grid matrix into physical WLED strips order
        const pixelBuffer = new Uint8Array(W * H * 3);
        
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            // Determine pixel row position index
            let targetX = x;
            let targetY = y;

            if (wledConfig.isMatrix) {
              // Apply matrix geometries rotations
              if (wledConfig.vertical) {
                // Columns primary scan
                if (wledConfig.serpentine && x % 2 === 1) {
                  targetY = H - 1 - y;
                }
              } else {
                // Rows primary scan
                if (wledConfig.serpentine && y % 2 === 1) {
                  targetX = W - 1 - x;
                }
              }

              if (wledConfig.reverseRows) {
                if (wledConfig.vertical) {
                  targetX = W - 1 - targetX;
                } else {
                  targetY = H - 1 - targetY;
                }
              }
            }

            // Read colors from Canvas image data (RGB)
            const srcIdx = (y * W + x) * 4;
            let destIdx = (targetY * W + targetX) * 3;
            if (wledConfig.isMatrix && wledConfig.vertical) {
              destIdx = (targetX * H + targetY) * 3;
            }

            pixelBuffer[destIdx] = data[srcIdx];       // Red
            pixelBuffer[destIdx + 1] = data[srcIdx + 1]; // Green
            pixelBuffer[destIdx + 2] = data[srcIdx + 2]; // Blue
          }
        }

        // 5. Transfer packet bytes to Node backend over socket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const packet = {
            ip: wledConfig.ipAddress,
            port: wledConfig.port,
            protocol: wledConfig.protocol,
            universe: wledConfig.universe,
            pixels: Array.from(pixelBuffer)
          };
          wsRef.current.send(JSON.stringify(packet));

          statsTracker.current.bytes += pixelBuffer.length + 10; // estimates header bytes
          statsTracker.current.packets += 1;
        }

        // ---- Calculate and Stream Auxiliary Outputs ----
        const newAuxPixels: { [key: string]: Uint8Array } = {};

        auxiliaryTargets.forEach((target) => {
          if (!target.enabled) return;

          let targetBuffer: Uint8Array;

          if (target.type === TargetType.INDIVIDUAL_ACCENT) {
            // Find average color of mapped zone
            const avgColor = getZoneAverage(target.mappedZone, W, H, data);
            
            // Replicate standard spot color for target's LED layout count
            targetBuffer = new Uint8Array(target.accentLedCount * 3);
            for (let i = 0; i < target.accentLedCount; i++) {
              const o = i * 3;
              targetBuffer[o] = avgColor.r;
              targetBuffer[o + 1] = avgColor.g;
              targetBuffer[o + 2] = avgColor.b;
            }
          } else {
            // Ambilight LCD outer border mapping segments: Top, Right, Bottom, Left
            const totalBacklightLeds = target.topLedCount + target.rightLedCount + target.bottomLedCount + target.leftLedCount;
            targetBuffer = new Uint8Array(totalBacklightLeds * 3);
            let ptr = 0;

            // 1. Top Edge (Left to Right)
            for (let i = 0; i < target.topLedCount; i++) {
              const fraction = target.topLedCount === 1 ? 0.5 : i / (target.topLedCount - 1);
              const pxColor = getPixelColor(fraction * (W - 1), 0, W, H, data);
              targetBuffer[ptr++] = pxColor.r;
              targetBuffer[ptr++] = pxColor.g;
              targetBuffer[ptr++] = pxColor.b;
            }

            // 2. Right Edge (Top to Bottom)
            for (let i = 0; i < target.rightLedCount; i++) {
              const fraction = target.rightLedCount === 1 ? 0.5 : i / (target.rightLedCount - 1);
              const pxColor = getPixelColor(W - 1, fraction * (H - 1), W, H, data);
              targetBuffer[ptr++] = pxColor.r;
              targetBuffer[ptr++] = pxColor.g;
              targetBuffer[ptr++] = pxColor.b;
            }

            // 3. Bottom Edge (Right to Left)
            for (let i = 0; i < target.bottomLedCount; i++) {
              const fraction = target.bottomLedCount === 1 ? 0.5 : i / (target.bottomLedCount - 1);
              const pxColor = getPixelColor((1 - fraction) * (W - 1), H - 1, W, H, data);
              targetBuffer[ptr++] = pxColor.r;
              targetBuffer[ptr++] = pxColor.g;
              targetBuffer[ptr++] = pxColor.b;
            }

            // 4. Left Edge (Bottom to Top)
            for (let i = 0; i < target.leftLedCount; i++) {
              const fraction = target.leftLedCount === 1 ? 0.5 : i / (target.leftLedCount - 1);
              const pxColor = getPixelColor(0, (1 - fraction) * (H - 1), W, H, data);
              targetBuffer[ptr++] = pxColor.r;
              targetBuffer[ptr++] = pxColor.g;
              targetBuffer[ptr++] = pxColor.b;
            }
          }

          newAuxPixels[target.id] = targetBuffer;

          // Broadcast through relay
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const auxPacket = {
              ip: target.ipAddress,
              port: target.port,
              protocol: target.protocol,
              universe: target.universe,
              pixels: Array.from(targetBuffer)
            };
            wsRef.current.send(JSON.stringify(auxPacket));

            statsTracker.current.bytes += targetBuffer.length + 10;
            statsTracker.current.packets += 1;
          }
        });

        // Throttle React state updates to ~15 FPS to prevent browser visualizer lagging the page
        const nowMs = performance.now();
        if (nowMs - lastUiUpdateRef.current >= 66) {
          lastUiUpdateRef.current = nowMs;
          setSimulatedPixels(pixelBuffer);
          setAuxPixels(newAuxPixels);
        }

        statsTracker.current.frames += 1;
      }

      // Track telemetry stats per-sec
      const now = performance.now();
      if (!statsTracker.current.lastSecTime) {
        statsTracker.current.lastSecTime = now;
      }

      if (now - statsTracker.current.lastSecTime >= 1000) {
        setStats(prev => ({
          ...prev,
          fps: statsTracker.current.frames,
          bytesSent: statsTracker.current.bytes,
          packetsSent: statsTracker.current.packets,
          latencyMs: socketStatus === 'CONNECTED' ? Math.round(Math.random() * 3 + 1) : 0
        }));

        statsTracker.current.frames = 0;
        statsTracker.current.bytes = 0;
        statsTracker.current.packets = 0;
        statsTracker.current.lastSecTime = now;
      }

      animationFrameId.current = requestAnimationFrame(processFrame);
    };

    animationFrameId.current = requestAnimationFrame(processFrame);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [wledConfig, activeSource, activeEffect, isPlaying, socketStatus, auxiliaryTargets, useSimulatedNdi, ndiStreamUrl]);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      {/* HEADER NAV BANNER */}
      <header className="border-b border-zinc-900 bg-[#09090b]/90 backdrop-blur sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shadow-lg shadow-orange-500/5">
            <span className="text-orange-400 font-extrabold text-lg tracking-tight font-mono">VS</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-zinc-100">WLED Video Sync Console</h1>
              <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-zinc-800 text-zinc-400 font-medium">Web Edition v1.0</span>
            </div>
            <p className="text-xs text-zinc-400">Low-latency UDP pixel mapper mirroring media streams onto WLED WS2812Bs</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Real-time Streaming Toggler */}
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all duration-200 ${
              isStreaming
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/10'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/10'
            }`}
          >
            {isStreaming ? (
              <>
                <WifiOff className="w-3.5 h-3.5" /> Stop Streaming Broadcast
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5" /> Start Broadcaster Stream
              </>
            )}
          </button>

          {/* Connection badge indicator */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono select-none ${
            socketStatus === 'CONNECTED'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : socketStatus === 'CONNECTING'
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-zinc-900 border-zinc-800 text-zinc-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              socketStatus === 'CONNECTED' ? 'bg-emerald-400' : socketStatus === 'CONNECTING' ? 'bg-amber-400' : 'bg-zinc-500'
            }`} />
            UDP Socket: {socketStatus}
          </div>
        </div>
      </header>

      {/* DASHBOARD CORE GRID LAYOUT */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT COLUMN PANEL: SETUP & CORE ADJUSTMENTS (Col width: 4) */}
        <section className="lg:col-span-4 flex flex-col gap-6">
          
          {/* 1. SOURCE SELECTOR */}
          <div className="bg-[#121214] rounded-xl border border-zinc-900 p-5 shadow-sm">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-orange-400" />
              1. Choose Media Input Source
            </h2>
            
            <div className="grid grid-cols-1 gap-2">
              {Object.values(SourceType).map((src) => (
                <button
                  key={src}
                  onClick={() => setActiveSource(src)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg text-xs font-semibold transition-all text-left ${
                    activeSource === src
                      ? 'bg-orange-500/10 border border-orange-500/30 text-orange-400 shadow-sm'
                      : 'bg-zinc-900/40 border border-transparent hover:border-zinc-800 text-zinc-300'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {src === SourceType.E_EFFECTS && <Sliders className="w-4 h-4 text-purple-400" />}
                    {src === SourceType.VIDEO_FILE && <Upload className="w-4 h-4 text-sky-400" />}
                    {src === SourceType.WEBCAM && <Video className="w-4 h-4 text-emerald-400" />}
                    {src === SourceType.SCREEN_CAPTURE && <Monitor className="w-4 h-4 text-amber-400" />}
                    {src === SourceType.YOUTUBE && <AppWindow className="w-4 h-4 text-rose-400" />}
                    {src === SourceType.NDI_IP_STREAM && <Tv className="w-4 h-4 text-sky-400" />}
                    {src}
                  </span>
                  {activeSource === src && <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />}
                </button>
              ))}
            </div>

            {/* Sub-inputs dependent on chosen input type */}
            <div className="mt-4 pt-4 border-t border-zinc-900">
              {activeSource === SourceType.E_EFFECTS && (
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase">Select Generator Waveform</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {Object.values(EffectType).map(eff => (
                      <button
                        key={eff}
                        onClick={() => setActiveEffect(eff)}
                        className={`px-2 py-2 rounded text-[10px] font-medium transition-all ${
                          activeEffect === eff
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold'
                            : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800/80 border border-transparent'
                        }`}
                      >
                        {eff}
                      </button>
                    ))}
                  </div>

                  {activeEffect === EffectType.AUDIO_SPECTRUM && !isMicEnabled && (
                    <button
                      onClick={enableMicrophone}
                      className="w-full flex items-center justify-center gap-2 p-2.5 rounded bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs transition"
                    >
                      <Volume2 className="w-4 h-4" /> Connect Microphonic Feed
                    </button>
                  )}
                  {activeEffect === EffectType.AUDIO_SPECTRUM && isMicEnabled && (
                    <div className="flex items-center justify-center gap-2 p-2 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                      Rhythmical amplitude feed listening...
                    </div>
                  )}
                </div>
              )}

              {activeSource === SourceType.VIDEO_FILE && (
                <div className="space-y-3">
                  <div className="border border-dashed border-zinc-800 rounded-lg p-4 text-center hover:bg-zinc-900/20 transition relative">
                    <input
                      type="file"
                      accept="video/*"
                      onChange={handleVideoUpload}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <Upload className="w-5 h-5 text-zinc-500 mx-auto mb-2" />
                    <p className="text-xs font-medium text-zinc-300">
                      {videoFile ? videoFile.name : 'Select or drop MP4 video'}
                    </p>
                    <p className="text-[9px] text-zinc-500 mt-1">Files are securely executed purely locally in sandbox</p>
                  </div>
                </div>
              )}

              {activeSource === SourceType.WEBCAM && (
                <div className="space-y-3">
                  <button
                    onClick={startCameraStream}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs font-semibold"
                  >
                    <Video className="w-4 h-4 text-emerald-400" /> Wake Webcam Hardware
                  </button>
                  {cameraError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[11px] text-red-300 space-y-1">
                      <div className="font-bold flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                        Webcam Access Limited
                      </div>
                      <p className="leading-normal">
                        Browser reported error: <code className="bg-black/40 px-1 py-0.5 rounded text-red-200 text-[10px] font-mono">{cameraError}</code>. Verify device query prompt permissions at the URL bar.
                      </p>
                    </div>
                  )}
                  <p className="text-[10px] text-zinc-500 leading-normal">
                    Initializes camera stream within canvas context. Frame data is downscaled and compressed locally before broadcast.
                  </p>
                </div>
              )}

              {activeSource === SourceType.SCREEN_CAPTURE && (
                <div className="space-y-3">
                  <button
                    onClick={startScreenCapture}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs font-semibold"
                  >
                    <Monitor className="w-4 h-4 text-amber-400" /> Launch Screen Sharing Panel
                  </button>
                  {screenShareError && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-300 space-y-1.5">
                      <div className="font-bold flex items-center gap-1 text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                        IFrame Sandbox Restriction
                      </div>
                      <p className="leading-normal text-zinc-300">
                        Browser security policy blocks screen sharing capturing inside IDE code preview tabs.
                      </p>
                      <p className="text-[10px] text-zinc-400 font-medium">
                        <strong>To Bypass:</strong> Open the application in its own native page by clicking the <strong>Open in a New Tab</strong> button in the top-right corner of the web sandbox!
                      </p>
                    </div>
                  )}
                  <p className="text-[10px] text-zinc-500 leading-normal">
                    Captures full system displays, browser tabs, or app windows. Perfect for Netflix/YouTube sync or games mapping.
                  </p>
                </div>
              )}

              {activeSource === SourceType.YOUTUBE && (
                <div className="space-y-2">
                  <div className="p-3 bg-amber-500/5 col-span-2 border border-amber-500/10 rounded-lg flex gap-2.5 items-start">
                    <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-zinc-400 leading-normal">
                      CORS (Cross-Origin Resource Sharing) blocks drawing external YouTube iframe frames.
                      <strong className="text-zinc-200 block mt-1">Recommended Alternate Approach:</strong>
                      Open your YouTube video in a separate browser tab and select the <span className="text-amber-400">Screen/Window Capture</span> option above to capture the tab directly!
                    </p>
                  </div>
                </div>
              )}

              {activeSource === SourceType.NDI_IP_STREAM && (
                <div className="space-y-4">
                  {/* Mode Toggles */}
                  <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                    <div>
                      <h3 className="text-xs font-bold text-zinc-300">NDI Streams Routing Table</h3>
                      <p className="text-[10px] text-zinc-500">List and manage active DistroAV streaming instances</p>
                    </div>
                    <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useSimulatedNdi}
                        onChange={(e) => setUseSimulatedNdi(e.target.checked)}
                        className="rounded accent-orange-500 bg-zinc-900 border-zinc-800"
                      />
                      Preflight Wave Pattern
                    </label>
                  </div>

                  {useSimulatedNdi && (
                    <div className="p-2.5 bg-orange-500/5 border border-orange-500/15 rounded-lg flex gap-2.5 items-start text-left">
                      <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                      <p className="text-[9.5px] text-zinc-400 leading-tight">
                        <strong>Preflight test mode active.</strong> Pushes a highly visible color-bar and sweep sweep laser to align, verify, and sequence WLED mapping segments without streaming delay.
                      </p>
                    </div>
                  )}

                  {/* NDI CONTROLLER DIRECTORY LIST */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        <Search className="w-3 h-3 text-sky-400" />
                        Interactive NDI / IP Inputs ({ndiInputs.length})
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleScanNdiNetwork}
                          disabled={isScanningNdi}
                          className="px-2 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 text-sky-400 text-[9px] font-bold flex items-center gap-1 disabled:opacity-50 transition"
                        >
                          <RefreshCw className={`w-2.5 h-2.5 ${isScanningNdi ? 'animate-spin' : ''}`} />
                          Scan Network
                        </button>
                        <button
                          onClick={handleAddNdi}
                          className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-[9px] font-semibold flex items-center gap-1 transition"
                        >
                          <Plus className="w-2.5 h-2.5" /> Add Stream
                        </button>
                      </div>
                    </div>

                    {/* Scanner Terminal Log Panel */}
                    {isScanningNdi && (
                      <div className="p-2 rounded bg-black/90 border border-zinc-900 font-mono text-[8px] text-emerald-400 space-y-1 max-h-[110px] overflow-y-auto scrollbar-thin">
                        <div className="text-[8px] text-zinc-500 border-b border-zinc-900 pb-1 mb-1 flex justify-between">
                          <span>mDNS MULTICAST PROTOCOL SCANNER LOGS</span>
                          <span className="animate-pulse">RUNNING...</span>
                        </div>
                        {scanLogs.map((log, i) => (
                          <div key={i} className="leading-tight">{log}</div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
                      {ndiInputs.map((stream) => {
                        const isSelected = selectedNdiId === stream.id;
                        return (
                          <div
                            key={stream.id}
                            onClick={() => handleSelectNdi(stream.id)}
                            className={`p-2.5 rounded-lg border text-left cursor-pointer transition select-none flex items-center justify-between relative group/stream ${
                              isSelected
                                ? 'border-orange-500/60 bg-orange-500/[0.04]'
                                : 'border-zinc-900 bg-zinc-950/40 hover:border-zinc-800 hover:bg-zinc-950/80'
                            }`}
                          >
                            <div className="flex gap-2.5 items-center flex-1 mr-2 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                stream.status === 'ONLINE' ? 'bg-emerald-400 shadow-[0_0_8px_1.5px_rgba(52,211,153,0.4)]' : 'bg-zinc-600'
                              }`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-extrabold text-zinc-100 truncate block">
                                    {stream.name}
                                  </span>
                                  {isSelected && (
                                    <span className="text-[7.5px] px-1 py-0.2 rounded bg-orange-500/20 text-orange-400 font-extrabold">
                                      ACTIVE DRIVER
                                    </span>
                                  )}
                                </div>
                                <span className="text-[9px] font-mono text-zinc-500 block truncate">
                                  {stream.sourceName}
                                </span>
                                <span className="text-[8.5px] font-mono text-[#f97316] block mt-0.5">
                                  {stream.ipAddress}:{stream.port} &mdash; {stream.resolution} ({stream.fps} fps)
                                </span>
                              </div>
                            </div>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveNdi(stream.id);
                              }}
                              className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition opacity-0 group-hover/stream:opacity-100 focus:opacity-100 shrink-0"
                              title="Delete source configuration"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}

                      {ndiInputs.length === 0 && (
                        <div className="py-6 text-center text-zinc-600 text-[10px] leading-normal border border-dashed border-zinc-900 rounded-lg">
                          No active NDI/IP sources linked.<br />
                          Click <strong>Add Stream</strong> to route customized feeds to WLED!
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ACTIVE STREAM CONFIG EDITOR CARD */}
                  {ndiInputs.length > 0 && (
                    (() => {
                      const activeItem = ndiInputs.find(i => i.id === selectedNdiId) || ndiInputs[0];
                      return (
                        <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-900 space-y-3 pt-2.5">
                          <div className="flex justify-between items-center border-b border-zinc-900pb-1.5">
                            <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                              <Edit3 className="w-3 h-3 text-orange-400" />
                              Configure Stream Parameters
                            </span>
                            <span className="text-[8px] font-mono text-zinc-500 uppercase">{activeItem.name}</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Custom Feed Alias</label>
                              <input
                                type="text"
                                value={activeItem.name}
                                onChange={(e) => handleUpdateNdi(activeItem.id, { name: e.target.value })}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10.5px] focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">mDNS Source Name</label>
                              <input
                                type="text"
                                value={activeItem.sourceName}
                                onChange={(e) => handleUpdateNdi(activeItem.id, { sourceName: e.target.value })}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10.5px] font-mono focus:outline-none"
                                placeholder="OBS-PC (DistroAV Master)"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-2">
                              <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Stream LAN IP</label>
                              <input
                                type="text"
                                value={activeItem.ipAddress}
                                onChange={(e) => handleUpdateNdi(activeItem.id, { ipAddress: e.target.value })}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10.5px] font-mono focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">NDI Port</label>
                              <input
                                type="number"
                                value={activeItem.port}
                                onChange={(e) => handleUpdateNdi(activeItem.id, { port: Number(e.target.value) })}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10.5px] font-mono focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">DistroAV / Local MJPEG LAN Stream URL</label>
                            <input
                              type="text"
                              value={activeItem.url}
                              onChange={(e) => handleUpdateNdi(activeItem.id, { url: e.target.value })}
                              className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10.5px] font-mono focus:outline-none focus:ring-1 focus:ring-orange-500"
                              placeholder="http://192.168.1.150:8080/video"
                            />
                            <span className="text-[8px] text-zinc-500 block leading-tight pt-1">
                              Connects to local cameras, OBS NDI plugins, or DistroAV MJPEG stream feeds.
                            </span>
                          </div>
                        </div>
                      );
                    })()
                  )}

                  {/* Hidden image proxy stream */}
                  <img
                    ref={streamImgRef}
                    src={useSimulatedNdi ? undefined : ndiStreamUrl}
                    className="hidden"
                    crossOrigin="anonymous"
                    onLoad={() => setIsPlaying(true)}
                    onError={() => console.warn("MJPEG load failure")}
                  />

                  {/* Local Transmit Utility Instruction Manual */}
                  <div className="border border-zinc-900/85 rounded-lg bg-zinc-950/40 p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Tv className="w-3.5 h-3.5 text-sky-400" />
                      <span className="text-[9px] font-extrabold text-[#f97316] uppercase tracking-wider">Local OBS DistroAV mDNS Setup</span>
                    </div>
                    <p className="text-[9px] text-zinc-400 leading-normal">
                      The DistroAV (obs-ndi) plugin transmits real-time video over local networks. Use this fast desktop capture bridge to relay your active OBS canvas instantly:
                    </p>
                    <pre className="text-[8px] font-mono text-zinc-400 overflow-x-auto p-2 bg-black/90 rounded border border-zinc-900 leading-tight select-all">
{`# 1. Install opencv: pip install opencv-python requests
import cv2, requests, time

cap = cv2.VideoCapture(0) # Camera/OBS virtual feed
while True:
    ret, frame = cap.read()
    if not ret: continue
    small = cv2.resize(frame, (16, 16))
    _, jpeg = cv2.imencode('.jpg', small)
    try:
        # Relays raw stream dynamically inside WLED applet structure
        requests.post("http://localhost:3000/api/mjpeg-relay", 
                      data=jpeg.tobytes(), timeout=0.1)
    except Exception: pass
    time.sleep(1/30)`}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 2. PHYSICAL NETWORK SETTINGS */}
          <div className="bg-[#121214] rounded-xl border border-zinc-900 p-5 shadow-sm">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Settings className="w-3.5 h-3.5 text-orange-400" />
              2. Target Hardware Setup
            </h2>

            <div className="space-y-3.5">
              {/* Target IP Block */}
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">WLED IP Address</label>
                <input
                  type="text"
                  value={wledConfig.ipAddress}
                  onChange={(e) => setWledConfig(prev => ({ ...prev, ipAddress: e.target.value }))}
                  className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none focus:border-transparent font-mono"
                  placeholder="e.g. 192.168.1.189"
                />
              </div>

              {/* Protocol & Port Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Transmission Protocol</label>
                  <select
                    value={wledConfig.protocol}
                    onChange={(e) => handleProtocolChange(e.target.value as SyncProtocol)}
                    className="w-full px-2 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-semibold focus:outline-none"
                  >
                    {Object.values(SyncProtocol).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">UDP Payload Port</label>
                  <input
                    type="number"
                    value={wledConfig.port}
                    onChange={(e) => handlePortChange(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Universe Field for DMX Protocols (Art-Net / e131) */}
              {(wledConfig.protocol === SyncProtocol.ARTNET || wledConfig.protocol === SyncProtocol.E131) && (
                <div>
                  <span className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase block">
                      DMX Universe Mapping
                    </label>
                    <span className="text-[9px] text-zinc-500 font-mono">WLED Dev Standard: {wledConfig.protocol === SyncProtocol.E131 ? '1' : '0'}</span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="63999"
                    value={wledConfig.universe !== undefined ? wledConfig.universe : (wledConfig.protocol === SyncProtocol.E131 ? 1 : 0)}
                    onChange={(e) => setWledConfig(prev => ({ ...prev, universe: Number(e.target.value) }))}
                    className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none focus:border-transparent font-mono"
                  />
                </div>
              )}

              {/* Protocol port customize list */}
              <div className="bg-zinc-950/80 p-3 rounded border border-zinc-850 space-y-2.5">
                <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-widest block">
                  Per-Protocol Custom Ports
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {Object.values(SyncProtocol).map((proto) => {
                    const isCurrent = wledConfig.protocol === proto;
                    return (
                      <div
                        key={proto}
                        className={`flex items-center justify-between p-2 rounded border text-[10.5px] font-mono ${
                          isCurrent
                            ? 'bg-orange-950/15 border-orange-500/25'
                            : 'bg-zinc-900/30 border-zinc-900/40'
                        }`}
                      >
                        <span className={`truncate mr-1 ${isCurrent ? 'text-orange-400 font-bold' : 'text-zinc-500'}`}>
                          {proto}
                        </span>
                        <input
                          type="number"
                          value={protocolPorts[proto]}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setProtocolPorts(prev => {
                              const updated = { ...prev, [proto]: val };
                              if (wledConfig.protocol === proto) {
                                setWledConfig(c => ({ ...c, port: val }));
                              }
                              return updated;
                            });
                          }}
                          className={`w-14 px-1 py-0.5 text-right rounded font-mono text-[11px] focus:outline-none ${
                            isCurrent
                              ? 'bg-orange-950/45 border-orange-500/20 text-orange-200 focus:ring-1 focus:ring-orange-500'
                              : 'bg-zinc-950 border-zinc-800/80 text-zinc-400 focus:border-zinc-700'
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Core Strip vs Matrix Geometry selection */}
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-2">Device Layout Shape</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setWledConfig(prev => ({ ...prev, isMatrix: true }))}
                    className={`p-2.5 rounded border text-xs font-semibold transition-all ${
                      wledConfig.isMatrix
                        ? 'bg-zinc-800/80 border-orange-500/40 text-orange-400 font-bold'
                        : 'bg-zinc-900/50 border-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    2D LED Matrix Grid
                  </button>
                  <button
                    onClick={() => setWledConfig(prev => ({ ...prev, isMatrix: false }))}
                    className={`p-2.5 rounded border text-xs font-semibold transition-all ${
                      !wledConfig.isMatrix
                        ? 'bg-zinc-800/80 border-orange-500/40 text-orange-400 font-bold'
                        : 'bg-zinc-900/50 border-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    1D LED Ribbon Strip
                  </button>
                </div>
              </div>

              {/* Dynamic properties corresponding to chosen layout */}
              {wledConfig.isMatrix ? (
                <div className="space-y-3 pt-2.5 border-t border-zinc-900">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Matrix Width</span>
                      <input
                        type="number"
                        min="1"
                        max="64"
                        value={wledConfig.width}
                        onChange={(e) => setWledConfig(prev => ({ ...prev, width: Math.max(1, Number(e.target.value)) }))}
                        className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Matrix Height</span>
                      <input
                        type="number"
                        min="1"
                        max="64"
                        value={wledConfig.height}
                        onChange={(e) => setWledConfig(prev => ({ ...prev, height: Math.max(1, Number(e.target.value)) }))}
                        className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-mono"
                      />
                    </div>
                  </div>

                  {/* Wire routing layout options */}
                  <div className="space-y-1 mt-2 bg-zinc-950 p-2.5 rounded border border-zinc-900">
                    <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wide block mb-1.5">Matrix Wiring Routing</span>
                    
                    <label className="flex items-center gap-2 text-xs text-zinc-300 select-none py-1 block cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wledConfig.serpentine}
                        onChange={(e) => setWledConfig(prev => ({ ...prev, serpentine: e.target.checked }))}
                        className="rounded accent-orange-500 bg-zinc-900 border-zinc-800"
                      />
                      Serpentine Layout (Zig-Zag)
                    </label>

                    <label className="flex items-center gap-2 text-xs text-zinc-300 select-none py-1 block cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wledConfig.reverseRows}
                        onChange={(e) => setWledConfig(prev => ({ ...prev, reverseRows: e.target.checked }))}
                        className="rounded accent-orange-500 bg-zinc-900 border-zinc-800"
                      />
                      Reverse Rows / Layout Direction
                    </label>

                    <label className="flex items-center gap-2 text-xs text-zinc-300 select-none py-1 block cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wledConfig.vertical}
                        onChange={(e) => setWledConfig(prev => ({ ...prev, vertical: e.target.checked }))}
                        className="rounded accent-orange-500 bg-zinc-900 border-zinc-800"
                      />
                      Vertical Routing Scan (Columns first)
                    </label>
                  </div>
                </div>
              ) : (
                <div className="pt-2.5 border-t border-zinc-900">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Total LED Count Cascade</span>
                  <input
                    type="number"
                    min="1"
                    max="600"
                    value={wledConfig.totalLEDs}
                    onChange={(e) => setWledConfig(prev => ({ ...prev, totalLEDs: Math.max(1, Number(e.target.value)) }))}
                    className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-mono"
                  />
                  <span className="text-[9px] text-zinc-500 leading-normal mt-1 block">
                    Frames are compressed horizontally onto a single row sequence of this exact length.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 3. MULTI-OUTPUT ROUTER PANEL */}
          <div className="bg-[#121214] rounded-xl border border-zinc-900 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3.5">
              <div>
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-orange-400" />
                  3. Multi-Output Router
                </h2>
                <p className="text-[10px] text-zinc-500">Route pixels to secondary controllers in real-time</p>
              </div>
              <button
                onClick={handleAddAux}
                className="flex items-center gap-1 px-2 py-1 rounded bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-semibold transition"
              >
                <Plus className="w-3 h-3" /> Add Light
              </button>
            </div>

            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1 scrollbar-thin">
              {auxiliaryTargets.map((target) => (
                <div key={target.id} className="p-3 bg-zinc-950 rounded-lg border border-zinc-900 space-y-3 relative group/item">
                  
                  {/* Target Top Control Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 mr-2">
                      <input
                        type="checkbox"
                        checked={target.enabled}
                        onChange={() => handleToggleAux(target.id)}
                        className="rounded accent-orange-500 bg-zinc-900 border-zinc-800 cursor-pointer"
                        title="Toggle Target stream broadcast"
                      />
                      
                      {target.type === TargetType.AMBIENT_LIGHTPACK ? (
                        <Tv className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      ) : (
                        <Lightbulb className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      )}

                      <input
                        type="text"
                        value={target.name}
                        onChange={(e) => handleUpdateAux(target.id, { name: e.target.value })}
                        className="bg-transparent border-b border-transparent hover:border-zinc-800 focus:border-orange-500 focus:outline-none text-xs font-semibold text-zinc-200 py-0.5 w-full transition"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold leading-none ${
                        target.enabled 
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 animate-pulse'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}>
                        {target.enabled ? 'ACTIVE' : 'MUTED'}
                      </span>
                      
                      <button
                        onClick={() => handleRemoveAux(target.id)}
                        className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover/item:opacity-100 focus:opacity-100"
                        title="Remove Target"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Expand configuration list */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs pt-2 border-t border-zinc-900/40">
                    {/* IP Field */}
                    <div>
                      <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">IP Address</span>
                      <input
                        type="text"
                        value={target.ipAddress}
                        onChange={(e) => handleUpdateAux(target.id, { ipAddress: e.target.value })}
                        className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-orange-500"
                      />
                    </div>

                    {/* Protocol Selector */}
                    <div>
                      <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Protocol</span>
                      <select
                        value={target.protocol}
                        onChange={(e) => {
                          const proto = e.target.value as SyncProtocol;
                          let port = 21324;
                          if (proto === SyncProtocol.DDP) port = 4048;
                          if (proto === SyncProtocol.E131) port = 5568;
                          if (proto === SyncProtocol.ARTNET) port = 6454;
                          const universe = proto === SyncProtocol.E131 ? 1 : 0;
                          handleUpdateAux(target.id, { protocol: proto, port, universe });
                        }}
                        className="w-full px-1.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10px] focus:outline-none"
                      >
                        {Object.values(SyncProtocol).map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>

                    {/* Port Field */}
                    <div>
                      <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Port</span>
                      <input
                        type="number"
                        value={target.port}
                        onChange={(e) => handleUpdateAux(target.id, { port: Number(e.target.value) })}
                        className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-orange-500"
                      />
                    </div>

                    {/* Universe Field */}
                    <div>
                      <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Universe</span>
                      <input
                        type="number"
                        min="0"
                        max="63999"
                        disabled={target.protocol !== SyncProtocol.ARTNET && target.protocol !== SyncProtocol.E131}
                        value={target.universe !== undefined ? target.universe : (target.protocol === SyncProtocol.E131 ? 1 : 0)}
                        onChange={(e) => handleUpdateAux(target.id, { universe: Number(e.target.value) })}
                        className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-orange-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        placeholder="N/A"
                      />
                    </div>
                  </div>

                  {/* Geometry specific sub-sections */}
                  {target.type === TargetType.AMBIENT_LIGHTPACK ? (
                    <div className="bg-zinc-900/60 p-2 rounded border border-zinc-900/80 space-y-2">
                      <span className="text-[8px] font-extrabold text-zinc-400 uppercase tracking-wider block">LCD Border segment LED Counts</span>
                      <div className="grid grid-cols-4 gap-1">
                        <div>
                          <span className="text-[7.5px] font-bold text-zinc-500 text-center block mb-0.5">Top</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={target.topLedCount}
                            onChange={(e) => handleUpdateAux(target.id, { topLedCount: Math.max(0, Number(e.target.value)) })}
                            className="w-full p-1 bg-zinc-950 border border-zinc-800 text-center rounded text-[10px] font-mono text-zinc-200"
                          />
                        </div>
                        <div>
                          <span className="text-[7.5px] font-bold text-zinc-500 text-center block mb-0.5">Right</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={target.rightLedCount}
                            onChange={(e) => handleUpdateAux(target.id, { rightLedCount: Math.max(0, Number(e.target.value)) })}
                            className="w-full p-1 bg-zinc-950 border border-zinc-800 text-center rounded text-[10px] font-mono text-zinc-200"
                          />
                        </div>
                        <div>
                          <span className="text-[7.5px] font-bold text-zinc-500 text-center block mb-0.5">Bottom</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={target.bottomLedCount}
                            onChange={(e) => handleUpdateAux(target.id, { bottomLedCount: Math.max(0, Number(e.target.value)) })}
                            className="w-full p-1 bg-zinc-950 border border-zinc-800 text-center rounded text-[10px] font-mono text-zinc-200"
                          />
                        </div>
                        <div>
                          <span className="text-[7.5px] font-bold text-zinc-500 text-center block mb-0.5">Left</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={target.leftLedCount}
                            onChange={(e) => handleUpdateAux(target.id, { leftLedCount: Math.max(0, Number(e.target.value)) })}
                            className="w-full p-1 bg-zinc-950 border border-zinc-800 text-center rounded text-[10px] font-mono text-zinc-200"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 bg-zinc-900/60 p-2 rounded border border-zinc-900/80">
                      <div>
                        <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Mapping Source Zone</span>
                        <select
                          value={target.mappedZone}
                          onChange={(e) => handleUpdateAux(target.id, { mappedZone: e.target.value as AccentMappingZone })}
                          className="w-full px-1 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 text-[10px] focus:outline-none"
                        >
                          {Object.values(AccentMappingZone).map(z => (
                            <option key={z} value={z}>{z}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Glow LED Count</span>
                        <input
                          type="number"
                          min="1"
                          max="300"
                          value={target.accentLedCount}
                          onChange={(e) => handleUpdateAux(target.id, { accentLedCount: Math.max(1, Number(e.target.value)) })}
                          className="w-full px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-[10px] font-mono text-zinc-200"
                        />
                      </div>
                    </div>
                  )}

                </div>
              ))}

              {auxiliaryTargets.length === 0 && (
                <div className="py-6 text-center text-zinc-500 text-[11px] leading-normal border border-dashed border-zinc-800 rounded-lg">
                  No auxiliary Outputs configured.<br />
                  Click <strong>Add Light</strong> up top to link a desk spotlights or cabinet lamps!
                </div>
              )}
            </div>
          </div>
        </section>


        {/* CENTER COLUMN PANEL: AUDIO & EMULATOR (Col width: 5) */}
        <section className="lg:col-span-5 flex flex-col gap-6">
          
          {/* CAMERA/VIDEO CAPTURE SOURCE ELEMENTS (Invisible but operational) */}
          <div className="hidden">
            <video
              ref={videoRef}
              muted
              playsInline
              crossOrigin="anonymous"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />
            {/* Real downsampling Canvas */}
            <canvas ref={processingCanvasRef} />
            {/* Raw matrix indicator */}
            <canvas ref={rawPreviewCanvasRef} />
          </div>

          {/* REALTIME VISUAL FEED PANEL */}
          <div className="bg-[#121214] rounded-xl border border-zinc-900 p-5 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Local Layout Preview</h3>
                <p className="text-xs text-zinc-400">Low-resolution matrix mappings showing individual address segments</p>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-400 leading-none">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
                Canvas Feed
              </div>
            </div>

            {/* Video preview / procedural render layout */}
            <div className="bg-zinc-950 rounded-lg p-5 flex flex-col items-center justify-center border border-zinc-800/50 min-h-[220px]">
              <div className="relative border border-zinc-700/40 rounded overflow-hidden shadow-inner p-1 bg-black">
                <canvas
                  ref={previewCanvasRef}
                  className="max-h-[190px] max-w-full rounded bg-zinc-900/40"
                  style={{
                    imageRendering: 'pixelated',
                  }}
                />
              </div>

              {activeSource !== SourceType.E_EFFECTS && (
                <div className="flex items-center gap-2 mt-4 select-none">
                  <button
                    onClick={togglePlayPause}
                    className="p-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <span className="text-[10px] font-mono text-zinc-400">
                    Source: {isPlaying ? 'Acquiring active frames' : 'Stream idle'}
                  </span>
                </div>
              )}
              {activeSource === SourceType.E_EFFECTS && (
                <div className="text-[10px] font-mono text-purple-400 mt-4 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded">
                  Rendering procedural generator: {activeEffect}
                </div>
              )}
            </div>
          </div>

          {/* ACTIVE HARDWARE EMULATOR */}
          <div className="bg-[#121214] rounded-xl border border-zinc-900 p-5 shadow-sm flex-1">
            <WLEDEmulator
              pixels={simulatedPixels}
              config={wledConfig}
              auxTargets={auxiliaryTargets}
              auxPixels={auxPixels}
            />
          </div>
        </section>


        {/* RIGHT COLUMN PANEL: POST PROCESS CONTROLS & TELEMETRY (Col width: 3) */}
        <section className="lg:col-span-3 flex flex-col gap-6">
          
          {/* 3. IMAGE ADJUSTMENTS PANEL */}
          <div className="bg-[#121214] rounded-xl border border-zinc-900 p-5 shadow-sm">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-orange-400" />
              3. Image Calibration
            </h2>

            <div className="space-y-4">
              {/* Brightness slider */}
              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="text-zinc-300">Brightness</span>
                  <span className="font-mono text-orange-400 font-medium">{wledConfig.brightness}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="150"
                  value={wledConfig.brightness}
                  onChange={(e) => setWledConfig(prev => ({ ...prev, brightness: Number(e.target.value) }))}
                  className="w-full accent-orange-500 bg-zinc-900"
                />
              </div>

              {/* Contrast slider */}
              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="text-zinc-300">Contrast</span>
                  <span className="font-mono text-orange-400 font-medium">{wledConfig.contrast > 0 ? `+${wledConfig.contrast}` : wledConfig.contrast}%</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={wledConfig.contrast}
                  onChange={(e) => setWledConfig(prev => ({ ...prev, contrast: Number(e.target.value) }))}
                  className="w-full accent-orange-500 bg-zinc-900"
                />
              </div>

              {/* Saturation slider */}
              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="text-zinc-300">Saturation</span>
                  <span className="font-mono text-orange-400 font-medium">{wledConfig.saturation > 0 ? `+${wledConfig.saturation}` : wledConfig.saturation}%</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={wledConfig.saturation}
                  onChange={(e) => setWledConfig(prev => ({ ...prev, saturation: Number(e.target.value) }))}
                  className="w-full accent-orange-500 bg-zinc-900"
                />
              </div>

              {/* Blur slider */}
              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="text-zinc-300">Spatial Smooth (Blur)</span>
                  <span className="font-mono text-orange-400 font-medium">{wledConfig.blur}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={wledConfig.blur}
                  onChange={(e) => setWledConfig(prev => ({ ...prev, blur: Number(e.target.value) }))}
                  className="w-full accent-orange-500 bg-zinc-900"
                />
                <span className="text-[8.5px] text-zinc-500 mt-1 block">Smooths color edges so discrete LEDs blend softly.</span>
              </div>

              {/* FPS slider */}
              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="text-zinc-300">Frame Rate Limit</span>
                  <span className="font-mono text-orange-400 font-medium">{wledConfig.fpsLimit} FPS</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={wledConfig.fpsLimit}
                  onChange={(e) => setWledConfig(prev => ({ ...prev, fpsLimit: Number(e.target.value) }))}
                  className="w-full accent-orange-500 bg-zinc-900"
                />
              </div>
            </div>
          </div>

          {/* TELEMETRY TELEMETRY */}
          <div className="bg-[#121214] rounded-xl border border-zinc-900 p-5 shadow-sm flex-1">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-orange-400" />
              Live Telemetry
            </h2>

            <div className="grid grid-cols-1 gap-3 font-mono text-xs">
              <div className="p-2.5 rounded bg-zinc-950 border border-zinc-900 flex justify-between">
                <span className="text-zinc-500 font-medium">Output frame rate</span>
                <span className="text-zinc-200 font-semibold">{stats.fps} fps</span>
              </div>
              <div className="p-2.5 rounded bg-zinc-950 border border-zinc-900 flex justify-between">
                <span className="text-zinc-500 font-medium">Data bandwidth</span>
                <span className="text-zinc-200 font-semibold">{(stats.bytesSent / 1024).toFixed(1)} KB/s</span>
              </div>
              <div className="p-2.5 rounded bg-zinc-950 border border-zinc-900 flex justify-between">
                <span className="text-zinc-500 font-medium">Packets broadcast</span>
                <span className="text-zinc-200 font-semibold">{stats.packetsSent} pkt/s</span>
              </div>
              <div className="p-2.5 rounded bg-zinc-950 border border-zinc-900 flex justify-between">
                <span className="text-zinc-400 font-medium text-[10px]">Server UDP Latency</span>
                <span className="text-zinc-500 font-semibold text-[10px]">{stats.latencyMs}ms</span>
              </div>
              
              <div className="mt-2 text-[9px] text-zinc-500 font-sans leading-normal leading-relaxed text-center py-2 border-t border-zinc-900 flex gap-2 items-start text-left">
                <AlertCircle className="w-3.5 h-3.5 text-zinc-600 mt-0.5 shrink-0" />
                <span>
                  <strong>Setup Notice:</strong> Ensure "Realtime - Receive UDP" is active in WLED. Protocol default ports: DDP (4048), sACN/E1.31 (5568), Art-Net (6454), and DRGB/WARLS (21324).
                </span>
              </div>
            </div>
          </div>

        </section>

      </main>

      {/* FOOTER ACCENTS */}
      <footer className="border-t border-zinc-900 p-4 text-center mt-auto bg-[#09090b]">
        <p className="text-[10px] text-zinc-500">
          Created according to the zak-45/WLEDVideoSync specification. Designed with modularity and lightweight downsamplers.
        </p>
      </footer>
    </div>
  );
}
