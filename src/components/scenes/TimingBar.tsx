"use client";

/**
 * The `timing` primitive (grappling hook): a needle swings sinusoidally (period 1.2 s) over a brass scale
 * with a green zone (18% of the width) and a perfect core (central 5%). One attempt: button or Space.
 */
import { useEffect, useRef, useState } from "react";
import { BrassButton, cx } from "@/components/ui/kit";

export type TimingResult = "perfect" | "hit" | "miss";

const PERIOD = 1.2;
const GREEN = 0.18;
const PERFECT = 0.05;

export function judge(pos: number): TimingResult {
  const d = Math.abs(pos - 0.5);
  if (d <= PERFECT / 2) return "perfect";
  if (d <= GREEN / 2) return "hit";
  return "miss";
}

const LABEL: Record<TimingResult, string> = {
  perfect: "ИДЕАЛЬНО! ×8",
  hit: "Зацепил! ×5",
  miss: "Звяк… мимо",
};

export default function TimingBar({ onThrow, title = "Крюк-кошка", className }: { onThrow: (r: TimingResult) => void; title?: string; className?: string }) {
  const needleRef = useRef<HTMLDivElement>(null);
  const onThrowRef = useRef(onThrow);
  const fireRef = useRef<() => void>(() => {});
  const [result, setResult] = useState<TimingResult | null>(null);

  useEffect(() => {
    onThrowRef.current = onThrow;
  }, [onThrow]);

  useEffect(() => {
    const t0 = performance.now();
    const phase = Math.random() * Math.PI * 2;
    let pos = 0.5;
    let thrown = false;
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (thrown) return;
      pos = 0.5 + 0.5 * Math.sin(((now - t0) / 1000 / PERIOD) * Math.PI * 2 + phase);
      if (needleRef.current) needleRef.current.style.left = `${(pos * 100).toFixed(2)}%`;
    };
    raf = requestAnimationFrame(loop);
    const fire = () => {
      if (thrown) return;
      thrown = true;
      const r = judge(pos);
      setResult(r);
      onThrowRef.current(r);
    };
    fireRef.current = fire;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        fire();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className={cx("pointer-events-auto flex w-[min(94%,460px)] flex-col gap-1.5 rounded-lg border border-brass-dark bg-soot/85 p-2 shadow-[0_6px_24px_rgba(0,0,0,.7)] backdrop-blur-sm", className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-display text-sm font-bold tracking-wide text-brass-light">🪝 {title}</span>
        <span className="text-parchment-dim">стрелку — в зелёное · пробел</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative h-9 min-w-0 flex-1 overflow-hidden rounded border border-brass-dark bg-[linear-gradient(180deg,#3a2e22,#1b1511)] shadow-[inset_0_2px_6px_rgba(0,0,0,.7)]">
          {Array.from({ length: 11 }, (_, i) => (
            <span key={i} className="absolute bottom-0 h-2 w-px bg-brass-dark" style={{ left: `${i * 10}%` }} />
          ))}
          <div className="absolute inset-y-1 rounded-sm bg-good/45 shadow-[0_0_10px_rgba(143,191,90,.5)]" style={{ left: `${(0.5 - GREEN / 2) * 100}%`, width: `${GREEN * 100}%` }} />
          <div className="absolute inset-y-0.5 rounded-sm bg-[#d8f5a0]" style={{ left: `${(0.5 - PERFECT / 2) * 100}%`, width: `${PERFECT * 100}%` }} />
          <div ref={needleRef} className="absolute inset-y-0 w-0" style={{ left: "50%" }}>
            <div className="absolute -left-[2px] inset-y-0 w-1 rounded bg-danger-light shadow-[0_0_8px_#e8705f]" />
            <div className="absolute -left-[6px] -top-0.5 h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-parchment" />
          </div>
          {result && (
            <div className={cx("absolute inset-0 flex items-center justify-center font-display text-lg font-bold tracking-wider", result === "miss" ? "bg-black/55 text-parchment-dim" : "bg-black/35 text-gaslight")} style={{ animation: "rr-pop .4s ease-out" }}>
              {LABEL[result]}
            </div>
          )}
        </div>
        <BrassButton size="md" tone="copper" className="min-h-11 shrink-0 whitespace-nowrap" disabled={!!result} onClick={() => fireRef.current()}>
          Бросить крюк!
        </BrassButton>
      </div>
    </div>
  );
}
