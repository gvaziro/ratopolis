"use client";

/**
 * Pieces shared by the crash screen, the save-issue dialogs, the settings' save section and app/global-error:
 * the gnawed-wire picture, the soot-and-brass frame, and save-file helpers.
 * No game imports here: global-error must still render when the game's own modules are what broke.
 */
import type { ReactNode } from "react";
import { fmtInt, plural } from "@/lib/format";

/* ------------------------------------------------------------ files */

/** Hand the player a text file: a Blob URL clicked through a temporary <a download>. False if the browser refused. */
export function downloadText(name: string, text: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** «ratropolis-save-2026-10-24-1530.txt»: a dated name, so several downloads do not overwrite each other. */
export function datedSaveName(now = new Date()): string {
  return `ratropolis-save-${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}.txt`;
}

/** «14:05» for today, «23.10 14:05» for an older moment (backups survive the night). */
export function clockAt(at: number): string {
  const d = new Date(at);
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${hm}`;
}

/** «1 крыса», «3 крысы», «12 крыс» (a no-break space: the count never parts from its noun); a compact «1.2K» reads
 * «…тысячи», so it takes the «крыс» form. */
export function ratsLabel(n: number): string {
  return `${fmtInt(n)} ${Math.abs(n) < 1000 ? plural(n, "крыса", "крысы", "крыс") : "крыс"}`;
}

/* ------------------------------------------------------------ art */

const WIRE_CSS = `
@keyframes rr-spark{0%,100%{opacity:1;transform:scale(1) rotate(0)}40%{opacity:.15;transform:scale(.45) rotate(25deg)}60%{opacity:.9;transform:scale(1.15) rotate(-10deg)}}
@keyframes rr-glint{0%,100%{opacity:.25}50%{opacity:.9}}
@keyframes rr-whisk{0%,100%{transform:rotate(0)}50%{transform:rotate(-8deg)}}
.rr-spark{transform-box:fill-box;transform-origin:center;animation:rr-spark .7s steps(4,jump-none) infinite}
.rr-glint{animation:rr-glint 1.1s ease-in-out infinite}
.rr-whisk{transform-box:fill-box;transform-origin:0 100%;animation:rr-whisk 1.8s ease-in-out infinite}
.rr-wire-calm .rr-spark,.rr-wire-calm .rr-glint,.rr-wire-calm .rr-whisk{animation:none}
@media (prefers-reduced-motion:reduce){.rr-spark,.rr-glint,.rr-whisk{animation:none}}
`;

/** Frayed copper strands fanning out of a cable end at (x, y); dir = +1 to the right, −1 to the left. */
function Strands({ x, y, dir }: { x: number; y: number; dir: 1 | -1 }) {
  const fan = [-11, -6, -2, 2, 6, 10];
  return (
    <g stroke="#d98a5a" strokeWidth="1.7" strokeLinecap="round" fill="none">
      {fan.map((dy, i) => (
        <path key={i} d={`M${x} ${y + dy * 0.35} q${dir * (7 + (i % 3) * 3)} ${dy * 0.4} ${dir * (12 + (i % 2) * 6)} ${dy}`} />
      ))}
      <path d={`M${x} ${y} l${dir * 17} -2`} stroke="#ffd7a8" strokeWidth="1" />
    </g>
  );
}

/**
 * «Крысы перегрызли провод»: a rubber-and-brass cable bitten through, copper strands frayed, sparks in the gap,
 * and the culprit sitting on the far end looking very pleased with itself.
 */
export function GnawedWire({ calm = false, className }: { calm?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 320 112" className={className} role="img" aria-label="Перегрызенный провод и довольная крыса">
      <style>{WIRE_CSS}</style>
      <g className={calm ? "rr-wire-calm" : undefined}>
        {/* soot wall with a bracket rail */}
        <rect x="0" y="0" width="320" height="112" rx="6" fill="#16120f" />
        <path d="M0 92 H320" stroke="#2c231b" strokeWidth="10" />
        <path d="M0 87.5 H320" stroke="#4a3a2a" strokeWidth="1" />
        {[30, 110, 210, 290].map((x) => (
          <g key={x}>
            <rect x={x - 5} y="70" width="10" height="20" rx="2" fill="#5e4520" stroke="#2a1f14" strokeWidth="1" />
            <circle cx={x} cy="84" r="1.6" fill="#c9a25a" />
          </g>
        ))}
        {/* left cable */}
        <path d="M-4 66 C40 66 70 58 128 60" stroke="#1c1814" strokeWidth="15" fill="none" strokeLinecap="round" />
        <path d="M-4 66 C40 66 70 58 128 60" stroke="#7a3f20" strokeWidth="11" fill="none" strokeLinecap="round" />
        <path d="M-4 62.5 C40 62.5 70 54.5 126 56.5" stroke="#b8693d" strokeWidth="2" fill="none" opacity=".6" />
        {/* brass ferrules */}
        <rect x="48" y="54" width="9" height="15" rx="2" fill="#c9a25a" stroke="#4a3a1a" strokeWidth="1" transform="rotate(-6 52 61)" />
        <rect x="236" y="55" width="9" height="15" rx="2" fill="#c9a25a" stroke="#4a3a1a" strokeWidth="1" transform="rotate(4 240 62)" />
        {/* tooth marks on the bitten end */}
        {[110, 117, 124].map((x) => (
          <circle key={x} cx={x} cy={53.5} r="2.6" fill="#16120f" />
        ))}
        <circle cx="121" cy="66.5" r="2.3" fill="#16120f" />
        <Strands x={130} y={60} dir={1} />
        {/* right cable */}
        <path d="M324 64 C280 64 250 58 192 60" stroke="#1c1814" strokeWidth="15" fill="none" strokeLinecap="round" />
        <path d="M324 64 C280 64 250 58 192 60" stroke="#7a3f20" strokeWidth="11" fill="none" strokeLinecap="round" />
        <path d="M324 60.5 C280 60.5 250 54.5 194 56.5" stroke="#b8693d" strokeWidth="2" fill="none" opacity=".6" />
        {[196, 203].map((x) => (
          <circle key={x} cx={x} cy={66.8} r="2.4" fill="#16120f" />
        ))}
        <Strands x={190} y={60} dir={-1} />
        {/* sparks in the gap */}
        <circle cx="160" cy="59" r="16" fill="#f2b84b" opacity=".12" className="rr-glint" />
        <path className="rr-spark" d="M160 47 L163 56 L172 57 L164 61 L167 70 L160 64 L153 70 L156 61 L148 57 L157 56Z" fill="#fff1c9" stroke="#f2b84b" strokeWidth="1.2" />
        <path className="rr-spark" style={{ animationDelay: "-.35s" }} d="M150 44 l2 4 4 1 -4 2 -2 4 -2 -4 -4 -2 4 -1z" fill="#f2b84b" />
        <path className="rr-spark" style={{ animationDelay: "-.2s" }} d="M171 70 l1.6 3 3 .8 -3 1.6 -1.6 3 -1.6 -3 -3 -1.6 3 -.8z" fill="#f2b84b" />
        {/* the culprit */}
        <g transform="translate(262 30)">
          <path className="rr-whisk" d="M-14 22 C-30 26 -34 14 -24 8" stroke="#8a7a6a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <ellipse cx="0" cy="18" rx="15" ry="11" fill="#5b4c40" stroke="#2a1f14" strokeWidth="1.2" />
          <ellipse cx="2" cy="21" rx="8" ry="6" fill="#7a6858" />
          <circle cx="-11" cy="6" r="9" fill="#5b4c40" stroke="#2a1f14" strokeWidth="1.2" />
          <circle cx="-6" cy="-2" r="4.6" fill="#5b4c40" stroke="#2a1f14" strokeWidth="1" />
          <circle cx="-6" cy="-2" r="2.4" fill="#b8693d" />
          <path d="M-18 7 L-24 9 L-18 11Z" fill="#5b4c40" stroke="#2a1f14" strokeWidth="1" />
          <circle cx="-24.5" cy="9" r="1.6" fill="#d98a5a" />
          {/* smug half-closed eye */}
          <path d="M-15 4.5 q2 -1.6 4 0" stroke="#14110f" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          {/* whiskers */}
          <path d="M-21 10 l-9 -3 M-21 11 l-9 2 M-20 12 l-7 5" stroke="#cfc3b0" strokeWidth=".6" />
          {/* a copper strand still in its teeth */}
          <path d="M-23 12 q-6 3 -12 1" stroke="#d98a5a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          {/* tiny top hat */}
          <rect x="-15" y="-8" width="9" height="2" rx=".8" fill="#1c1814" transform="rotate(-14 -11 -7)" />
          <rect x="-13.5" y="-15" width="6" height="7.5" rx="1" fill="#1c1814" transform="rotate(-14 -11 -7)" />
          <rect x="-13.5" y="-10" width="6" height="1.4" fill="#c9a25a" transform="rotate(-14 -11 -7)" />
          {/* paws on the cable */}
          <ellipse cx="-4" cy="28.5" rx="3.4" ry="2" fill="#7a6858" />
          <ellipse cx="7" cy="28.5" rx="3.4" ry="2" fill="#7a6858" />
        </g>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------ frame */

/**
 * A soot panel in a double brass frame with rivets: the house style of every «something went wrong» dialog.
 * Tailwind-only (no kit imports) so app/global-error can use it with globals.css.
 */
export function SootFrame({ children, className, labelledBy }: { children: ReactNode; className?: string; labelledBy?: string }) {
  const rivet = "absolute h-2 w-2 rounded-full bg-gradient-to-br from-brass-light to-brass-dark shadow-[0_0_0_1px_rgba(0,0,0,.5)]";
  return (
    <section
      aria-labelledby={labelledBy}
      className={
        "relative w-full rounded-xl border-2 border-brass bg-gradient-to-b from-panel-2 via-panel to-soot-2 p-1 shadow-[0_0_0_1px_#2a1f14,0_24px_60px_rgba(0,0,0,.8),inset_0_1px_0_rgba(255,241,201,.25)] " +
        (className ?? "")
      }
    >
      <div className="relative rounded-lg border border-brass-dark/80 px-4 pb-4 pt-3 sm:px-5">
        <span className={`${rivet} left-1.5 top-1.5`} />
        <span className={`${rivet} right-1.5 top-1.5`} />
        <span className={`${rivet} bottom-1.5 left-1.5`} />
        <span className={`${rivet} bottom-1.5 right-1.5`} />
        {children}
      </div>
    </section>
  );
}

/** Plain brass button classes (for places that cannot import the kit, e.g. global-error). */
export const BRASS_BTN =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-brass-dark bg-gradient-to-b from-brass-light via-brass to-brass-dark px-3 py-1.5 text-sm font-bold tracking-wide text-soot shadow-[inset_0_1px_0_rgba(255,255,255,.45),0_2px_0_#4a3a1a] transition hover:brightness-110 active:translate-y-px active:shadow-none disabled:cursor-not-allowed disabled:opacity-45";
export const GHOST_BTN =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-line bg-panel-2/60 px-3 py-1.5 text-sm font-bold tracking-wide text-parchment transition hover:bg-panel-3 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45";
