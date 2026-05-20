import { WLEDConfig } from '../types';

interface WLEDEmulatorProps {
  pixels: Uint8Array | number[];
  config: WLEDConfig;
}

export default function WLEDEmulator({ pixels, config }: WLEDEmulatorProps) {
  const pixelCount = config.isMatrix
    ? config.width * config.height
    : config.totalLEDs;

  // Formulate RGB string arrays for ease of rendering
  const ledColors: string[] = [];
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 3;
    const r = pixels[offset] !== undefined ? pixels[offset] : 0;
    const g = pixels[offset + 1] !== undefined ? pixels[offset + 1] : 0;
    const b = pixels[offset + 2] !== undefined ? pixels[offset + 2] : 0;
    ledColors.push(`rgb(${r}, ${g}, ${b})`);
  }

  return (
    <div className="flex flex-col h-full justify-between">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">WLED Hardware Simulator</h3>
          <p className="text-xs text-zinc-400">
            Real-time projection model for {config.isMatrix ? `${config.width}x${config.height} Grid` : `${config.totalLEDs} LED Strip`}
          </p>
        </div>
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm animate-pulse">
          <span className="w-1 h-1 rounded-full bg-amber-400"></span>
          Simulating WLED Output
        </span>
      </div>

      <div className="flex-1 min-h-[220px] flex items-center justify-center bg-zinc-950 rounded-lg p-6 border border-zinc-800/60 shadow-inner relative overflow-hidden">
        {/* Dark Room Ambient Glow Background */}
        <div className="absolute inset-x-0 bottom-0 top-0 pointer-events-none opacity-25 filter blur-3xl mix-blend-screen transition-all duration-300 transform scale-110"
             style={{
               background: `radial-gradient(circle, ${ledColors[Math.floor(ledColors.length / 2)] || 'rgba(0,0,0,0)'} 0%, rgba(0,0,0,0) 70%)`
             }}
        />

        {config.isMatrix ? (
          <div
            className="grid gap-[3px] select-none justify-center items-center"
            style={{
              gridTemplateColumns: `repeat(${config.width}, minmax(0, 1fr))`,
              width: '100%',
              maxWidth: `${Math.min(config.width * 28, 420)}px`,
              aspectRatio: `${config.width}/${config.height}`
            }}
          >
            {ledColors.map((color, idx) => {
              // Calculate real physical coordinates for tooltip
              const row = Math.floor(idx / config.width);
              let col = idx % config.width;
              
              // Map display order to physical index incorporating Serpentine settings
              let physicalIndex = idx;
              if (config.serpentine && row % 2 === 1) {
                col = config.width - 1 - col;
                physicalIndex = row * config.width + col;
              }
              const displayColor = ledColors[physicalIndex] || 'rgb(0,0,0)';

              return (
                <div
                  key={idx}
                  className="rounded-full aspect-square relative group transition-all duration-100 ease-in"
                  style={{
                    backgroundColor: displayColor,
                    boxShadow: displayColor !== 'rgb(0,0,0)' 
                      ? `0 0 10px 1.5px ${displayColor}, inset 0 0 1.5px 0.5px rgba(255, 255, 255, 0.4)`
                      : 'inset 0 0 1px 0.5px rgba(255, 255, 255, 0.05)',
                  }}
                  title={`LED #${physicalIndex} (${row},${col})`}
                >
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[10px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 font-mono shadow-md">
                    #{physicalIndex} : {displayColor}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="w-full flex flex-col items-center">
            {/* 1D Strip horizontal scrollable layout */}
            <div className="w-full max-w-[450px] overflow-x-auto py-5 px-3 bg-zinc-900/40 rounded border border-zinc-800/40 flex gap-1 items-center justify-start scrollbar-thin">
              {ledColors.map((color, idx) => (
                <div
                  key={idx}
                  className="w-3.5 h-3.5 rounded-full shrink-0 relative group transition-all duration-100 ease-in"
                  style={{
                    backgroundColor: color,
                    boxShadow: color !== 'rgb(0,0,0)'
                      ? `0 0 9px 1.5px ${color}, inset 0 0 1px 0.5px rgba(255,255,255,0.4)`
                      : 'inset 0 0 1px 0.5px rgba(255,255,255,0.05)',
                  }}
                >
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[10px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 font-mono shadow-md">
                    LED #{idx} : {color}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10px] font-mono text-zinc-500 mt-2 text-center">
              Click/Hover over LED beads for coordinate mappings and numeric RGB readings
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
