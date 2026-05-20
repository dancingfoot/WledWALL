/**
 * WLED Video Sync Types
 */

export enum SyncProtocol {
  DDP = 'DDP',
  DRGB = 'DRGB',
  WARLS = 'WARLS',
  ARTNET = 'Art-Net'
}

export enum SourceType {
  VIDEO_FILE = 'Video File',
  SCREEN_CAPTURE = 'Screen/Window Capture',
  WEBCAM = 'Cam/Webcam Capture',
  YOUTUBE = 'YouTube Stream',
  E_EFFECTS = 'Procedural Effects'
}

export enum EffectType {
  RAINBOW = 'Rainbow Wave',
  PERLIN_NOISE = 'Perlin Noise Clouds',
  FIRE = 'Raging Fire',
  SINE_WAVES = 'Interfering Sine Waves',
  AUDIO_SPECTRUM = 'Audio Spectrum (Visualizer)',
  SOLID_COLOR = 'Solid Color Gradient'
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
}

export interface FrameStats {
  fps: number;
  droppedFrames: number;
  bytesSent: number;
  packetsSent: number;
  latencyMs: number;
}
