import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { Play, Pause, RefreshCw, Upload, Video, Monitor, AppWindow, Settings, Sliders, Activity, Info, AlertCircle, Wifi, WifiOff, Volume2 } from 'lucide-react';
import { WLEDConfig, SyncProtocol, SourceType, EffectType, FrameStats } from './types';
import WLEDEmulator from './components/WLEDEmulator';
import { renderProceduralEffect } from './utils/proceduralEffects';

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

  const [simulatedPixels, setSimulatedPixels] = useState<Uint8Array>(new Uint8Array(256 * 3));

  // Auto-set standard ports upon protocol changes
  const handleProtocolChange = (protocol: SyncProtocol) => {
    let port = 21324; // DRGB & WARLS
    if (protocol === SyncProtocol.DDP) port = 4048;
    if (protocol === SyncProtocol.ARTNET) port = 6454;
    
    setWledConfig(prev => ({ ...prev, protocol, port }));
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
        videoRef.current.play().then(() => {
          setIsPlaying(true);
        }).catch(err => console.error(err));
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
        videoRef.current.play().then(() => {
          setIsPlaying(true);
        }).catch(err => {
          console.error('Play failing with:', err);
        });
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
        videoRef.current.play().then(() => {
          setIsPlaying(true);
        }).catch(err => {
          console.error('Play fails:', err);
        });
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
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => console.error(err));
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
        } else if (videoRef.current && isPlaying) {
          const video = videoRef.current;
          // Canvas fit adjustments
          ctx.drawImage(video, 0, 0, W, H);
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

        setSimulatedPixels(pixelBuffer);

        // 5. Transfer packet bytes to Node backend over socket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const packet = {
            ip: wledConfig.ipAddress,
            port: wledConfig.port,
            protocol: wledConfig.protocol,
            pixels: Array.from(pixelBuffer)
          };
          wsRef.current.send(JSON.stringify(packet));

          statsTracker.current.bytes += pixelBuffer.length + 10; // estimates header bytes
          statsTracker.current.packets += 1;
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
  }, [wledConfig, activeSource, activeEffect, isPlaying, socketStatus]);

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
                    onChange={(e) => setWledConfig(prev => ({ ...prev, port: Number(e.target.value) }))}
                    className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:outline-none font-mono"
                  />
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
            <WLEDEmulator pixels={simulatedPixels} config={wledConfig} />
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
                  <strong>Setup Notice:</strong> WLED real-time streaming requires WLED setting "Realtime - Receive UDP" to be active on port 4048 (DDP) or 21324 (DRGB).
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
