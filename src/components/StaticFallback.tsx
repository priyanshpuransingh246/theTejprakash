import React, { useState } from 'react';
import { FIVE_TERMS } from './DefinitionsView';

interface StaticFallbackProps {
  initialView?: 'hero' | 'paper';
}

/**
 * Accessible static styled HTML version rendered when prefers-reduced-motion is enabled
 * or WebGL is unavailable.
 */
export const StaticFallback: React.FC<StaticFallbackProps> = ({ initialView = 'hero' }) => {
  const [view, setView] = useState<'hero' | 'paper'>(initialView);
  const [studioMode, setStudioMode] = useState(0);
  const modes = [
    'AI Mode: 1 Person → Fan 1 (50%)',
    'AI Mode: 2 People → Fan 1 (100%)',
    'AI Mode: 3 People → Fan 1 & 2 (50%)',
    'AI Mode: 4+ People → Fan 1 & 2 (100%)',
    'Manual Mode: Fan 1 & Fan 2 Direct Control',
  ];

  if (view === 'paper') {
    return (
      <main className="w-screen h-screen bg-[#050507] text-white relative overflow-hidden select-text">
        <button
          type="button"
          onClick={() => setView('hero')}
          className="fixed left-[21.9vw] top-[23.8vh] -translate-x-1/2 -translate-y-1/2 px-5 py-2.5 rounded-lg bg-[#17171b] border border-white/15 text-white hover:text-[#b9aee8] text-xs font-medium cursor-pointer transition-colors"
        >
          ← Back
        </button>

        <div className="fixed left-[32.4vw] w-[33.9vw] max-md:left-[8vw] max-md:w-[84vw] top-[34vh] max-md:top-[22vh]">
          <h1 className="text-white font-semibold tracking-[-0.022em] text-[clamp(18px,1.36vw,28px)] mb-6">
            The Tejprakash, in five system rules.
          </h1>
          <div className="flex flex-col gap-4">
            {FIVE_TERMS.map((item) => (
              <p
                key={item.term}
                className="text-[clamp(12px,0.73vw,15px)] leading-[1.72] text-white/60 m-0"
              >
                <strong className="text-white font-semibold">{item.term}</strong> — {item.body}
              </p>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="w-screen h-screen bg-[#050507] flex flex-col justify-between px-[5.5vw] py-[8.5vh] max-sm:p-4 select-text overflow-hidden">
      <header className="h-[10.8%] bg-[#17171b] border border-white/10 rounded-2xl px-8 flex items-center justify-between shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="w-3.5 h-3.5 rounded-sm bg-white/90 inline-block" />
          <span className="text-white/90 font-semibold text-sm">The Tejprakash</span>
        </div>
        <nav className="hidden sm:flex items-center gap-4 text-xs text-white/60">
          <button
            type="button"
            onClick={() => setStudioMode((m) => (m + 1) % modes.length)}
            className="hover:text-white transition-colors cursor-pointer"
          >
            Camera
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setStudioMode((m) => (m + 1) % modes.length)}
            className="hover:text-white transition-colors cursor-pointer"
          >
            Controller
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setView('paper')}
            className="hover:text-white transition-colors cursor-pointer"
          >
            AI Rules
          </button>
        </nav>
        <button
          type="button"
          onClick={() => setStudioMode((m) => (m + 1) % modes.length)}
          className="text-xs font-medium text-white/75 hover:text-white transition-colors cursor-pointer"
        >
          Manual / AI
        </button>
      </header>

      <section className="flex-1 mt-[14px] bg-[#17171b] border border-white/10 rounded-2xl p-12 flex flex-col justify-between relative overflow-hidden shadow-2xl">
        <div className="my-auto">
          <p className="text-[11px] tracking-[0.2em] text-white/40 uppercase font-medium mb-6">
            THE TEJPRAKASH · ENERGY CONSERVATION
          </p>
          <h1 className="text-[clamp(2.5rem,6.5vw,6.2rem)] font-medium tracking-[-0.045em] leading-[0.97] bg-gradient-to-b from-[#dcdce0] to-[#bdbdc3] bg-clip-text text-transparent mb-7">
            Smart class,
            <br />
            zero waste.
          </h1>
          <p className="text-white/55 text-base leading-relaxed max-w-xl mb-8">
            Automated classroom fan and lighting control powered by live camera vision.
            <br />
            Pair a smartphone camera with AI occupancy rules or manual L298N motor control.
          </p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setStudioMode((m) => (m + 1) % modes.length)}
              className="px-5 py-2.5 rounded-md bg-[#ededf0] hover:bg-[#36d67e] text-[#09090c] text-xs font-medium transition-colors cursor-pointer"
            >
              Camera
            </button>
            <button
              type="button"
              onClick={() => setStudioMode((m) => (m + 1) % modes.length)}
              className="px-5 py-2.5 rounded-md bg-white/10 border border-white/25 hover:border-[#36d67e] hover:text-[#36d67e] text-white text-xs font-medium transition-colors cursor-pointer"
            >
              Controller
            </button>
            <button
              type="button"
              onClick={() => setView('paper')}
              className="text-white/80 hover:text-white hover:underline text-xs font-medium cursor-pointer ml-2"
            >
              System rules →
            </button>
          </div>
        </div>

        <footer className="flex items-center justify-between text-[11px] text-white/35">
          <span>© The Tejprakash · B.Tech AIML Project</span>
          <span>Arduino UNO · L298N · {modes[studioMode]}</span>
        </footer>
      </section>
    </main>
  );
};
