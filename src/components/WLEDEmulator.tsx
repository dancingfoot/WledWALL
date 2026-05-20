import { useState } from 'react';
import { WLEDConfig, AuxiliaryTarget, TargetType } from '../types';
import { Video, Monitor, Tv, Lightbulb, Grid } from 'lucide-react';

interface WLEDEmulatorProps {
  pixels: Uint8Array | number[];
  config: WLEDConfig;
  auxTargets?: AuxiliaryTarget[];
  auxPixels?: { [key: string]: Uint8Array };
}

export default function WLEDEmulator({ pixels, config, auxTargets = [], auxPixels = {} }: WLEDEmulatorProps) {
  const [activeTab, setActiveTab] = useState<'MAIN' | 'AMBIENT' | 'ACCENT'>('MAIN');

  // Find enabled ambient/accent targets
  const hasAmbient = auxTargets.some(t => t.type === TargetType.AMBIENT_LIGHTPACK && t.enabled);
  const hasAccent = auxTargets.some(t => t.type === TargetType.INDIVIDUAL_ACCENT && t.enabled);

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

  // Find the first active Backlight target
  const activeBacklight = auxTargets.find(t => t.type === TargetType.AMBIENT_LIGHTPACK && t.enabled);
  const backlightPixels = activeBacklight ? auxPixels[activeBacklight.id] : null;

  // Parse backlight LEDs
  const backlightColors: string[] = [];
  if (activeBacklight && backlightPixels) {
    const totalLEDs = activeBacklight.topLedCount + activeBacklight.rightLedCount + activeBacklight.bottomLedCount + activeBacklight.leftLedCount;
    for (let i = 0; i < totalLEDs; i++) {
      const offset = i * 3;
      const r = backlightPixels[offset] !== undefined ? backlightPixels[offset] : 0;
      const g = backlightPixels[offset + 1] !== undefined ? backlightPixels[offset + 1] : 0;
      const b = backlightPixels[offset + 2] !== undefined ? backlightPixels[offset + 2] : 0;
      backlightColors.push(`rgb(${r}, ${g}, ${b})`);
    }
  }

  // Find active Accent targets
  const activeAccents = auxTargets.filter(t => t.type === TargetType.INDIVIDUAL_ACCENT && t.enabled);

  return (
    <div className="flex flex-col h-full justify-between">
      {/* Dynamic Selector Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-zinc-800 pb-3 mb-4 gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Hardware Stream Simulator</h3>
          <p className="text-xs text-zinc-400">
            Real-time projection model mapping raw UDP commands of multiple targets
          </p>
        </div>
        
        {/* Simulation Targets Tab */}
        <div className="flex gap-1 bg-zinc-900/60 p-0.5 rounded-lg border border-zinc-800 self-start md:self-auto">
          <button
            onClick={() => setActiveTab('MAIN')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold transition-all ${
              activeTab === 'MAIN'
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Grid className="w-3 h-3" /> Main Panel
          </button>
          
          <button
            onClick={() => setActiveTab('AMBIENT')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold transition-all relative ${
              activeTab === 'AMBIENT'
                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Tv className="w-3 h-3" /> Ambilight
            {!hasAmbient && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-zinc-600 border border-[#121214]" title="Disabled" />
            )}
            {hasAmbient && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sky-400 border border-[#121214] animate-ping" />
            )}
          </button>
          
          <button
            onClick={() => setActiveTab('ACCENT')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold transition-all relative ${
              activeTab === 'ACCENT'
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Lightbulb className="w-3 h-3" /> Spot Lamps
            {!hasAccent && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-zinc-600 border border-[#121214]" title="Disabled" />
            )}
            {hasAccent && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-purple-400 border border-[#121214] animate-ping" />
            )}
          </button>
        </div>
      </div>

      {/* CORE CANVAS DRAWINGS ROOM */}
      <div className="flex-1 min-h-[260px] flex items-center justify-center bg-zinc-950 rounded-lg p-6 border border-zinc-800/60 shadow-inner relative overflow-hidden">
        
        {/* Dynamic Screen Glow depending on active tab */}
        {activeTab === 'MAIN' && (
          <div className="absolute inset-x-0 bottom-0 top-0 pointer-events-none opacity-20 filter blur-3xl mix-blend-screen transition-all duration-300 transform scale-110 animate-pulse"
               style={{
                 background: `radial-gradient(circle, ${ledColors[Math.floor(ledColors.length / 2)] || 'rgba(0,0,0,0)'} 0%, rgba(0,0,0,0) 70%)`
               }}
          />
        )}

        {/* TAB 1: MAIN MATRIX / RIBBON SIMULATION */}
        {activeTab === 'MAIN' && (
          config.isMatrix ? (
            <div
              className="grid gap-[3px] select-none justify-center items-center py-2"
              style={{
                gridTemplateColumns: `repeat(${config.width}, minmax(0, 1fr))`,
                width: '100%',
                maxWidth: `${Math.min(config.width * 28, 420)}px`,
                aspectRatio: `${config.width}/${config.height}`
              }}
            >
              {ledColors.map((color, idx) => {
                const row = Math.floor(idx / config.width);
                let col = idx % config.width;
                
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
                  >
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[9px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 font-mono shadow-md">
                      #{physicalIndex} : {displayColor}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="w-full flex flex-col items-center py-4">
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
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[9px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 font-mono shadow-md">
                      LED #{idx} : {color}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-2 text-center">
                Main WLED continuous light bead sequence simulator
              </div>
            </div>
          )
        )}

        {/* TAB 2: AMBILIGHT LCD MONITOR SIMULATION */}
        {activeTab === 'AMBIENT' && (
          <div className="w-full flex flex-col items-center justify-center p-2 relative">
            {!hasAmbient ? (
              <div className="text-center text-zinc-500 text-xs py-10 space-y-2">
                <Tv className="w-8 h-8 text-zinc-700 mx-auto" />
                <p>Ambilight Backlight mapping is currently inactive.</p>
                <p className="text-[10px] text-zinc-600">Activate "LCD Backlight (Lightpack/Ambilight)" under hardware config to unlock!</p>
              </div>
            ) : (
              <div className="relative w-[340px] h-[210px] flex items-center justify-center">
                {/* Simulated Monitor Screen Center */}
                <div className="w-60 h-36 bg-zinc-900 rounded-lg border-2 border-zinc-700 shadow-2xl flex flex-col items-center justify-center p-3 text-center z-10 relative">
                  <Monitor className="w-6 h-6 text-zinc-500 mb-1" />
                  <span className="text-[10px] font-bold text-zinc-300">AMBILIGHT BACKLIGHT FEED</span>
                  <span className="text-[8.5px] text-zinc-500 font-mono mt-0.5">
                    {activeBacklight?.ipAddress} | {activeBacklight?.protocol}
                  </span>
                  <span className="text-[8.5px] text-sky-400 font-bold font-mono mt-1 px-1.5 py-0.5 bg-sky-500/5 rounded border border-sky-500/10">
                    {backlightColors.length} LEDs Active
                  </span>
                </div>

                {/* Draw dynamic halo surrounding monitor screen */}
                <div 
                  className="absolute inset-0 pointer-events-none filter blur-2xl opacity-40 rounded transition-all duration-300"
                  style={{
                    background: backlightColors.length > 0 
                      ? `radial-gradient(ellipse, ${backlightColors[0]} 0%, rgba(0,0,0,0) 80%)`
                      : 'rgba(0,0,0,0)'
                  }}
                />

                {/* 1. Draw Top Edge LEDs */}
                {activeBacklight && Array.from({ length: activeBacklight.topLedCount }).map((_, idx) => {
                  const colorIdx = idx;
                  const displayColor = backlightColors[colorIdx] || 'rgb(0,0,0)';
                  const leftPercentage = activeBacklight.topLedCount === 1 
                    ? 50 
                    : 15 + (idx / (activeBacklight.topLedCount - 1)) * 70; // Map between bounds of screen
                  return (
                    <div
                      key={`top-${idx}`}
                      className="absolute w-2.5 h-2.5 rounded-full transition-all duration-700"
                      style={{
                        top: '16px',
                        left: `${leftPercentage}%`,
                        backgroundColor: displayColor,
                        boxShadow: `0 0 12px 3px ${displayColor}`
                      }}
                      title={`Backlight Top LED #${idx}`}
                    />
                  );
                })}

                {/* 2. Draw Right Edge LEDs */}
                {activeBacklight && Array.from({ length: activeBacklight.rightLedCount }).map((_, idx) => {
                  const colorIdx = activeBacklight.topLedCount + idx;
                  const displayColor = backlightColors[colorIdx] || 'rgb(0,0,0)';
                  const topPercentage = activeBacklight.rightLedCount === 1 
                    ? 50 
                    : 22 + (idx / (activeBacklight.rightLedCount - 1)) * 56;
                  return (
                    <div
                      key={`right-${idx}`}
                      className="absolute w-2.5 h-2.5 rounded-full transition-all duration-700"
                      style={{
                        right: '34px',
                        top: `${topPercentage}%`,
                        backgroundColor: displayColor,
                        boxShadow: `0 0 12px 3px ${displayColor}`
                      }}
                      title={`Backlight Right LED #${idx}`}
                    />
                  );
                })}

                {/* 3. Draw Bottom Edge LEDs */}
                {activeBacklight && Array.from({ length: activeBacklight.bottomLedCount }).map((_, idx) => {
                  const colorIdx = activeBacklight.topLedCount + activeBacklight.rightLedCount + idx;
                  const displayColor = backlightColors[colorIdx] || 'rgb(0,0,0)';
                  const leftPercentage = activeBacklight.bottomLedCount === 1 
                    ? 50 
                    : 85 - (idx / (activeBacklight.bottomLedCount - 1)) * 70; // Map backwards for CW circle
                  return (
                    <div
                      key={`bottom-${idx}`}
                      className="absolute w-2.5 h-2.5 rounded-full transition-all duration-700"
                      style={{
                        bottom: '16px',
                        left: `${leftPercentage}%`,
                        backgroundColor: displayColor,
                        boxShadow: `0 0 12px 3px ${displayColor}`
                      }}
                      title={`Backlight Bottom LED #${idx}`}
                    />
                  );
                })}

                {/* 4. Draw Left Edge LEDs */}
                {activeBacklight && Array.from({ length: activeBacklight.leftLedCount }).map((_, idx) => {
                  const colorIdx = activeBacklight.topLedCount + activeBacklight.rightLedCount + activeBacklight.bottomLedCount + idx;
                  const displayColor = backlightColors[colorIdx] || 'rgb(0,0,0)';
                  const topPercentage = activeBacklight.leftLedCount === 1 
                    ? 50 
                    : 78 - (idx / (activeBacklight.leftLedCount - 1)) * 56;
                  return (
                    <div
                      key={`left-${idx}`}
                      className="absolute w-2.5 h-2.5 rounded-full transition-all duration-700"
                      style={{
                        left: '34px',
                        top: `${topPercentage}%`,
                        backgroundColor: displayColor,
                        boxShadow: `0 0 12px 3px ${displayColor}`
                      }}
                      title={`Backlight Left LED #${idx}`}
                    />
                  );
                })}

              </div>
            )}
          </div>
        )}

        {/* TAB 3: INDIVIDUAL STANDING ACCENT LAMPS ACCENTS */}
        {activeTab === 'ACCENT' && (
          <div className="w-full flex flex-col items-center justify-center p-2">
            {!hasAccent ? (
              <div className="text-center text-zinc-500 text-xs py-10 space-y-2">
                <Lightbulb className="w-8 h-8 text-zinc-700 mx-auto" />
                <p>Individual Accent Spotlight mappings are currently inactive.</p>
                <p className="text-[10px] text-zinc-600">Activate an "Individual Accent Lamp" under hardware config config to unlock!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-[420px] py-4">
                {activeAccents.map((accent) => {
                  const accentColor = auxPixels[accent.id];
                  let displayRGB = 'rgb(24, 24, 27)';
                  if (accentColor && accentColor.length >= 3) {
                    displayRGB = `rgb(${accentColor[0]}, ${accentColor[1]}, ${accentColor[2]})`;
                  }

                  return (
                    <div 
                      key={accent.id}
                      className="flex flex-col items-center p-4 bg-zinc-900/30 rounded-xl border border-zinc-800/80 hover:border-zinc-700 transition relative overflow-hidden"
                    >
                      {/* Dynamic light spot behind bulb logo */}
                      <div 
                        className="absolute w-20 h-20 rounded-full filter blur-xl opacity-30 mt-2 pointer-events-none transition-all duration-300"
                        style={{
                          backgroundColor: displayRGB,
                          boxShadow: `0 0 35px 20px ${displayRGB}`
                        }}
                      />
                      
                      <div 
                        className="w-12 h-12 rounded-full border-2 border-zinc-700 flex items-center justify-center z-10 p-1 mb-3 transition-colors duration-200"
                        style={{
                          borderColor: displayRGB !== 'rgb(24, 24, 27)' ? displayRGB : '#3f3f46',
                          backgroundColor: displayRGB
                        }}
                      >
                        <Lightbulb className={`w-6 h-6 ${displayRGB !== 'rgb(24, 24, 27)' ? 'text-zinc-900' : 'text-zinc-500'}`} />
                      </div>

                      <span className="text-[11px] font-bold text-zinc-200">{accent.name}</span>
                      <span className="text-[9px] text-zinc-500 font-mono mt-0.5">{accent.ipAddress}</span>
                      <span className="text-[9px] text-purple-400 font-bold bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/10 mt-2">
                        {accent.mappedZone}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
