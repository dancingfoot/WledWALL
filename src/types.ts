/**
 * WLED Video Sync Types
 */

export enum SyncProtocol {
  DDP = 'DDP',
  DRGB = 'DRGB',
  WARLS = 'WARLS',
  ARTNET = 'Art-Net',
  E131 = 'E1.31'
}

export enum SourceType {
  VIDEO_FILE = 'Video File',
  SCREEN_CAPTURE = 'Screen/Window Capture',
  WEBCAM = 'Cam/Webcam Capture',
  YOUTUBE = 'YouTube Stream',
  E_EFFECTS = 'Procedural Effects',
  NDI_IP_STREAM = 'NDI / IP Video Stream'
}

export enum EffectType {
  RAINBOW = 'Rainbow Wave',
  PERLIN_NOISE = 'Perlin Noise Clouds',
  FIRE = 'Raging Fire',
  SINE_WAVES = 'Interfering Sine Waves',
  AUDIO_SPECTRUM = 'Audio Spectrum (Visualizer)',
  SOLID_COLOR = 'Solid Color Gradient'
}

export enum TargetType {
  MAIN = 'Main Device (Matrix/Strip)',
  AMBIENT_LIGHTPACK = 'LCD Backlight (Lightpack/Ambilight)',
  INDIVIDUAL_ACCENT = 'Individual Accent Lamp'
}

export enum AccentMappingZone {
  WHOLE_AVERAGE = 'Whole Screen Average',
  CENTER = 'Center Zone (Inner)',
  TOP = 'Top Edge Average',
  BOTTOM = 'Bottom Edge Average',
  LEFT = 'Left Edge Average',
  RIGHT = 'Right Edge Average'
}

export interface AuxiliaryTarget {
  id: string;
  name: string;
  type: TargetType;
  enabled: boolean;
  ipAddress: string;
  port: number;
  protocol: SyncProtocol;
  universe?: number;
  
  // Ambilight LCD parameters
  topLedCount: number;
  rightLedCount: number;
  bottomLedCount: number;
  leftLedCount: number;
  
  // Accent mapping parameter
  mappedZone: AccentMappingZone;
  accentLedCount: number; // e.g., how many duplicate averaged pixel values to send (WLED size)
}

export interface WLEDConfig {
  ipAddress: string;
  port: number;
  protocol: SyncProtocol;
  isMatrix: boolean;
  width: number; // For matrix
  height: number; // For matrix
  totalLEDs: number; // For single strip
  serpentine: boolean;
  reverseRows: boolean;
  vertical: boolean;
  brightness: number; // 0-100%
  contrast: number; // -100 to 100
  saturation: number; // -100 to 100
  gamma: number; // 0.5 to 3.0
  blur: number; // Blur radius
  fpsLimit: number;
  timeout: number; // 2 seconds
  universe?: number; // Optional universe field (Defaults: Art-Net=0, sACN=1)
}

export interface FrameStats {
  fps: number;
  droppedFrames: number;
  bytesSent: number;
  packetsSent: number;
  latencyMs: number;
}

export interface NdiStreamInput {
  id: string;
  name: string;
  sourceName: string; // e.g. "OBS-DESKTOP (Distro AV - Program)"
  ipAddress: string;
  port: number;
  url: string;
  enabled: boolean;
  resolution: string;
  fps: number;
  status: 'ONLINE' | 'OFFLINE' | 'DISCOVERING';
}

