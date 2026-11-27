"use client";

import { useEffect, useRef } from "react";

type Drop = {
  x: number;
  y: number;
  radius: number;
  velocity: number;
  trail: Array<[number, number]>;
};

type Ripple = {
  x: number;
  age: number;
  maxRadius: number;
};

export function WaterGlass() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let previousTime = performance.now();
    let drops: Drop[] = [];
    let ripples: Ripple[] = [];

    function fitCanvas() {
      if (!canvas || !context) return;
      const mobile = window.innerWidth < 720;
      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        mobile ? 1.5 : 2,
      );
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drops = mobile
        ? createDrops(18)
        : createDrops(36);
      if (reduceMotion) draw(performance.now());
    }

    function createDrops(count: number): Drop[] {
      return Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height * 0.82,
        radius: 1.5 + Math.random() * 5,
        velocity: 4 + Math.random() * 11,
        trail: [],
      }));
    }

    function draw(time: number) {
      if (!context) return;
      context.clearRect(0, 0, width, height);

      const poolY = height - Math.max(34, height * 0.055);
      context.beginPath();
      context.moveTo(0, height);
      for (let x = 0; x <= width + 10; x += 12) {
        const y =
          poolY +
          Math.sin(x * 0.02 + time * 0.0014) * 1.6 +
          Math.sin(x * 0.007 - time * 0.0008) * 1.2;
        context.lineTo(x, y);
      }
      context.lineTo(width, height);
      context.closePath();
      const pool = context.createLinearGradient(0, poolY, 0, height);
      pool.addColorStop(0, "rgba(18,169,189,.34)");
      pool.addColorStop(1, "rgba(8,127,157,.12)");
      context.fillStyle = pool;
      context.fill();

      for (const drop of drops) {
        context.beginPath();
        context.arc(
          drop.x,
          drop.y,
          drop.radius,
          0,
          Math.PI * 2,
        );
        context.fillStyle = "rgba(125,210,226,.16)";
        context.fill();
        context.strokeStyle = "rgba(255,255,255,.34)";
        context.lineWidth = 0.9;
        context.stroke();

        if (drop.trail.length > 1) {
          context.beginPath();
          context.moveTo(drop.trail[0][0], drop.trail[0][1]);
          for (const point of drop.trail.slice(1)) {
            context.lineTo(point[0], point[1]);
          }
          context.strokeStyle = "rgba(170,235,245,.10)";
          context.lineWidth = Math.max(1.2, drop.radius * 0.8);
          context.stroke();
        }
      }

      for (const ripple of ripples) {
        const remaining = 1 - ripple.age / 1.4;
        if (remaining <= 0) continue;
        context.beginPath();
        context.ellipse(
          ripple.x,
          poolY + 6,
          ripple.age * ripple.maxRadius,
          ripple.age * ripple.maxRadius * 0.18,
          0,
          0,
          Math.PI * 2,
        );
        context.strokeStyle = `rgba(210,250,252,${remaining * 0.5})`;
        context.lineWidth = 1.2;
        context.stroke();
      }
    }

    function animate(time: number) {
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      const poolY = height - Math.max(34, height * 0.055);

      for (const drop of drops) {
        drop.velocity = Math.min(28 + drop.radius * 12, drop.velocity + 30 * delta);
        drop.y += drop.velocity * delta;
        drop.x += Math.sin(drop.y * 0.045) * delta * 3;
        drop.trail.push([drop.x, drop.y]);
        if (drop.trail.length > 18) drop.trail.shift();

        if (drop.y + drop.radius >= poolY) {
          ripples.push({
            x: drop.x,
            age: 0,
            maxRadius: 28 + drop.radius * 5,
          });
          drop.y = -drop.radius;
          drop.x = Math.random() * width;
          drop.radius = 1.5 + Math.random() * 5;
          drop.velocity = 4 + Math.random() * 11;
          drop.trail = [];
        }
      }

      for (const ripple of ripples) {
        ripple.age += delta;
      }
      ripples = ripples.filter((ripple) => ripple.age < 1.4);
      draw(time);
      frame = requestAnimationFrame(animate);
    }

    fitCanvas();
    if (!reduceMotion) {
      frame = requestAnimationFrame(animate);
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!reduceMotion && !frame) {
        previousTime = performance.now();
        frame = requestAnimationFrame(animate);
      }
    }

    window.addEventListener("resize", fitCanvas);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("resize", fitCanvas);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <canvas
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1] h-full w-full"
      ref={canvasRef}
    />
  );
}
