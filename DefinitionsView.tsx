import React from 'react';

interface DefinitionsViewProps {
  opacity: number;
  visible: boolean;
  backHovered: boolean;
  onBackHoverChange: (hovered: boolean) => void;
  onBackClick: () => void;
  viewportW: number;
  viewportH: number;
}

export const FIVE_TERMS = [
  {
    term: 'Smartphone Camera Node',
    body: 'Any smartphone on the network can grant camera permission to act as a live classroom vision sensor, streaming real-time video directly to the controller feed without expensive CCTV hardware.',
  },
  {
    term: 'Password-Protected Controller',
    body: 'Controller access is locked behind a password so only authorized students or faculty can manage classroom power—switching between Manual human control and autonomous AI Model mode while viewing the live camera feed.',
  },
  {
    term: 'Manual Dual-Fan Control',
    body: 'In Manual mode, the operator watches the live classroom footage and independently switches Fan 1 (Motor 1) and Fan 2 (Motor 2) on or off and adjusts their speed (Low, Mid, or Full).',
  },
  {
    term: 'AI Occupancy Speed Rules',
    body: 'In AI Model mode, headcount drives motor output automatically: 1 person runs Motor 1 at 50% speed; 2 people run Motor 1 at 100%; 3 people run both motors at 50%; and 4+ people run both motors at 100% speed.',
  },
  {
    term: 'Arduino UNO & L298N Hardware',
    body: 'Connected to the laptop via USB, an Arduino UNO SMD drives an L298N motor driver (D2–D5 → IN1–IN4, Fan 1 on OUT1/OUT2, Fan 2 on OUT3/OUT4) powered by a 12V 1A adapter with shared common GND.',
  },
];

export const DefinitionsView: React.FC<DefinitionsViewProps> = ({
  opacity,
  visible,
  onBackHoverChange,
  onBackClick,
  viewportW,
}) => {
  const isCompact = viewportW < 768;

  const titleFontSize = isCompact ? '20px' : '1.36vw';
  const bodyFontSize = isCompact ? '13px' : '0.73vw';
  const paragraphGap = isCompact ? '14px' : '1.05vw';

  return (
    <section
      aria-label="The Tejprakash system specifications"
      aria-hidden={!visible}
      data-testid="definitions-view"
      className="fixed inset-0 z-20 pointer-events-none select-text"
      style={{
        opacity,
        visibility: visible ? 'visible' : 'hidden',
        transition: 'none',
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
        className="fixed -translate-x-1/2 -translate-y-1/2 cursor-pointer text-transparent bg-transparent border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b9aee8] rounded px-8 py-5 whitespace-nowrap shrink-0"
        style={{
          left: isCompact ? '22vw' : '21.9vw',
          top: isCompact ? '14vh' : '23.8vh',
          fontSize: isCompact ? '13px' : '0.66vw',
          fontWeight: 500,
          pointerEvents: visible ? 'auto' : 'none',
          letterSpacing: '-0.01em',
        }}
      >
        ← Back
      </button>

      {/* Five terms column: starts at 32.4% W, 33.9% W wide, title baseline at 35.9% H */}
      <div
        className="fixed"
        style={{
          left: isCompact ? '8vw' : '32.4vw',
          width: isCompact ? '84vw' : '33.9vw',
          top: isCompact ? '22vh' : 'calc(35.9vh - 1.15vw)',
          pointerEvents: visible ? 'auto' : 'none',
        }}
      >
        <h2
          className="text-white m-0"
          style={{
            fontSize: titleFontSize,
            fontWeight: 650,
            letterSpacing: '-0.022em',
            lineHeight: 1.15,
            marginBottom: isCompact ? '18px' : '1.45vw',
          }}
        >
          The Tejprakash, in five system rules.
        </h2>

        <div
          className="flex flex-col"
          style={{
            gap: paragraphGap,
          }}
        >
          {FIVE_TERMS.map((item) => (
            <p
              key={item.term}
              className="m-0"
              style={{
                fontSize: bodyFontSize,
                lineHeight: 1.72,
                color: 'rgba(255, 255, 255, 0.60)',
                fontWeight: 400,
              }}
            >
              <strong className="font-semibold text-white">{item.term}</strong>
              <span className="text-white"> — </span>
              {item.body}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
};
