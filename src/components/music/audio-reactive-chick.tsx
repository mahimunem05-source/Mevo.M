import { memo, useEffect, useRef } from "react";
import { getLiveMultiBandLevels } from "@/lib/multi-band-audio";
import { cn } from "@/lib/utils";

interface AudioReactiveChickProps {
  isPlaying: boolean;
  bpm?: number;
  className?: string;
}

export const AudioReactiveChick = memo(function AudioReactiveChick({
  isPlaying,
  bpm = 120,
  className,
}: AudioReactiveChickProps) {
  // Direct DOM refs for 60-120 FPS GPU rendering (0 React state overhead)
  const chickContainerRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  // Smooth Ambient Kinematics State
  const stateRef = useRef({
    x: 0,
    y: 0,
    scale: 1,
    rotate: 0,
    glowOpacity: 0.3,
    glowScale: 1,
    shadowScale: 1,
    shadowOpacity: 0.4,
  });

  useEffect(() => {
    let animId: number;

    const renderLoop = (timeMs: number) => {
      const t = timeMs / 1000;
      const live = getLiveMultiBandLevels(isPlaying, timeMs);
      const state = stateRef.current;

      let targetX = 0;
      let targetY = 0;
      let targetScale = 1;
      let targetRotate = 0;
      let targetGlowOpacity = 0.3;
      let targetGlowScale = 1;
      let targetShadowScale = 1;
      let targetShadowOpacity = 0.4;

      if (isPlaying) {
        // --- 1. SLOW & SMOOTH LEFT-TO-RIGHT GLIDING (3.8s - 4.8s Stage Walk) ---
        // Relaxed, elegant gliding cycle across center between Left & Right EQ bars
        const glidePeriod = 4.4; // 4.4 seconds per full left-right-left roundtrip
        const glidePhase = (t / glidePeriod) * Math.PI * 2;

        // Smooth sine wave with slight dwell/pause at the turning points near the EQ bars
        const rawGlide = Math.sin(glidePhase);
        const smoothGlide = Math.sign(rawGlide) * Math.pow(Math.abs(rawGlide), 0.85);
        targetX = smoothGlide * 20.0; // glides up to ±20px towards EQ bars

        // --- 2. GENTLE DIRECTIONAL TILT ---
        // Slight soft tilt in the direction of gliding (negative left, positive right)
        // Velocity derived from derivative of sine: cos(glidePhase)
        const glideVelocity = Math.cos(glidePhase);
        targetRotate = glideVelocity * 3.2; // -3.2deg to +3.2deg

        // --- 3. SUBTLE, NON-AGGRESSIVE VERTICAL HOVERING (translateY: -3px to -6px) ---
        // Slow gentle floating wave + subtle bass groove (smooth & floaty)
        const floatWave = Math.sin(t * 2.4) * 1.8;
        const gentleBass = live.bass * 2.8; // subtle, non-aggressive
        targetY = -3.2 + floatWave - gentleBass; // smoothly hovers between -2px and -6.5px

        // --- 4. GENTLE BREATHING / PULSE SCALING (scale 1.0 to 1.04) ---
        const breathingPulse = Math.sin(t * 1.8) * 0.015;
        const bassPulse = live.bass * 0.025;
        targetScale = 1.0 + breathingPulse + bassPulse;

        // --- 5. SHADOW & AMBIENT GLOW PROXIMITY SYNC ---
        // Near EQ bars (when |X| is larger), glow gently brightens
        const eqProximity = Math.min(1.0, Math.abs(state.x) / 20.0);
        targetGlowOpacity = 0.28 + eqProximity * 0.18 + live.bass * 0.22;
        targetGlowScale = 1.0 + eqProximity * 0.14 + live.bass * 0.12;

        // Shadow scales smoothly with altitude
        const altitude = Math.max(0, -state.y);
        targetShadowScale = Math.max(0.65, 1.08 - altitude * 0.04);
        targetShadowOpacity = Math.max(0.22, 0.65 - altitude * 0.035);
      } else {
        // --- 6. PAUSED STATE: SEAMLESS CENTERED IDLE FLOAT ---
        // Smoothly glide back to center and enter a very slow ambient breathing cycle
        targetX = 0;
        const idleBreath = Math.sin(t * 1.4);
        targetY = -2.0 + idleBreath * 1.8;
        targetScale = 1.0 + idleBreath * 0.012;
        targetRotate = Math.sin(t * 0.9) * 0.8;

        targetGlowOpacity = 0.24 + idleBreath * 0.05;
        targetGlowScale = 0.96 + idleBreath * 0.04;
        targetShadowScale = 1.0 - idleBreath * 0.05;
        targetShadowOpacity = 0.38 + idleBreath * 0.04;
      }

      // --- 7. FLUID LERP INTERPOLATION (Ultra-Smooth, Zero Jerkiness) ---
      // Relaxed, elegant lerp factors for silk-smooth ambient floating motion
      const lerpX = isPlaying ? 0.08 : 0.05; // smooth gliding transition
      const lerpY = isPlaying ? 0.12 : 0.06; // soft vertical float
      const lerpScale = isPlaying ? 0.14 : 0.06; // gentle breathing
      const lerpRot = isPlaying ? 0.09 : 0.05; // soft tilt

      state.x += (targetX - state.x) * lerpX;
      state.y += (targetY - state.y) * lerpY;
      state.scale += (targetScale - state.scale) * lerpScale;
      state.rotate += (targetRotate - state.rotate) * lerpRot;

      state.glowOpacity += (targetGlowOpacity - state.glowOpacity) * 0.1;
      state.glowScale += (targetGlowScale - state.glowScale) * 0.1;
      state.shadowScale += (targetShadowScale - state.shadowScale) * 0.12;
      state.shadowOpacity += (targetShadowOpacity - state.shadowOpacity) * 0.12;

      // Apply direct GPU transforms
      if (chickContainerRef.current) {
        chickContainerRef.current.style.transform = `translate3d(${state.x.toFixed(2)}px, ${state.y.toFixed(2)}px, 0) scale(${state.scale.toFixed(3)}) rotate(${state.rotate.toFixed(2)}deg)`;
      }

      if (shadowRef.current) {
        shadowRef.current.style.transform = `translate3d(${state.x.toFixed(2)}px, 0, 0) scale(${state.shadowScale.toFixed(3)})`;
        shadowRef.current.style.opacity = `${state.shadowOpacity.toFixed(2)}`;
      }

      if (glowRef.current) {
        glowRef.current.style.transform = `translate(calc(-50% + ${state.x.toFixed(2)}px), -50%) scale(${state.glowScale.toFixed(3)})`;
        glowRef.current.style.opacity = `${state.glowOpacity.toFixed(2)}`;
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isPlaying, bpm]);

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center shrink-0 pointer-events-none select-none",
        className,
      )}
    >
      {/* Ambient Audio-Reactive Teal Glow Aura (Glides with Chick) */}
      <div
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 size-24 rounded-full bg-teal-500/25 blur-xl will-change-transform"
      />

      {/* Dynamic Soft Contact Shadow (Glides with Chick) */}
      <div
        ref={shadowRef}
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-1 size-16 rounded-full bg-teal-400/25 blur-md will-change-transform shadow-[0_4px_12px_rgba(0,0,0,0.6)]"
      />

      {/* Subtle floating music notes on active playback */}
      {isPlaying && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1 -left-2 text-[10px] text-teal-300 select-none font-bold animate-particle-left"
          >
            ♪
          </span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-2 -right-2 text-[10px] text-teal-300 select-none font-bold animate-particle-right"
          >
            ♫
          </span>
        </>
      )}

      {/* Ultra-Smooth Gliding Beat Chick Mascot */}
      <div
        ref={chickContainerRef}
        className="relative z-10 size-20 filter drop-shadow-[0_6px_14px_rgba(0,0,0,0.6)] flex items-center justify-center will-change-transform origin-bottom"
      >
        <img
          src="/beat-chick.png"
          alt="Beat Chick Mascot"
          width={80}
          height={80}
          loading="eager"
          decoding="async"
          className="size-full object-contain pointer-events-none select-none"
        />
      </div>
    </div>
  );
});
