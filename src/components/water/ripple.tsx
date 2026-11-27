"use client";

import { useState, type PointerEvent, type ReactNode } from "react";

type RippleProps = {
  children: ReactNode;
  className?: string;
};

type RippleRing = {
  id: number;
  left: number;
  top: number;
  size: number;
};

export function Ripple({ children, className = "" }: RippleProps) {
  const [rings, setRings] = useState<RippleRing[]>([]);

  function handlePointerDown(event: PointerEvent<HTMLSpanElement>) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const size = Math.max(bounds.width, bounds.height) * 2;
    const ring: RippleRing = {
      id: performance.now(),
      left: event.clientX - bounds.left - size / 2,
      top: event.clientY - bounds.top - size / 2,
      size,
    };

    setRings((current) => [...current, ring]);
    window.setTimeout(() => {
      setRings((current) => current.filter((item) => item.id !== ring.id));
    }, 700);
  }

  return (
    <span
      className={`relative inline-flex overflow-hidden ${className}`}
      onPointerDown={handlePointerDown}
    >
      {children}
      {rings.map((ring) => (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full bg-white/40 animate-[ripple_.7s_ease-out_forwards]"
          key={ring.id}
          style={{
            height: ring.size,
            left: ring.left,
            top: ring.top,
            width: ring.size,
          }}
        />
      ))}
    </span>
  );
}
