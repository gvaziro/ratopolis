"use client";

/**
 * «Мастерская художника» — the dev art gallery at /dev/art (v3 SHL-6, visuals-11): every chamber of every building at
 * the five visual tiers (1, 5, 10, 25, 50) with the idle / no-steam moods, each zone band at 1:1, a rat of every job
 * (and the zone looks), and the drawn resource glyphs. Switches: chamber mood, reduced motion and the time of day.
 * Read-only use of the colony's art; the page drives a private, never-saved game state (all zones open) in the store —
 * it mounts no game loop, so nothing is ticked or written to any save slot. Development only: the route 404s in
 * production builds.
 */
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { BUILDINGS, BUILDING_ORDER, VISUAL_TIERS } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { RESOURCES } from "@/game/data/resources";
import { ZONES, ZONE_ORDER } from "@/game/data/zones";
import { createInitialState } from "@/game/engine/state";
import { useGame } from "@/game/store";
import { JOB_IDS, type BuildingId, type GameState, type ZoneId } from "@/game/types";
import { BuildingArt } from "@/components/colony/buildingArt";
import { NICHE } from "@/components/colony/Chamber";
import { COLONY_CSS } from "@/components/colony/colonyCss";
import { artLevel, BAND_H, bandTop, shade, W as COLONY_W } from "@/components/colony/geometry";
import { Defs, Glow, type GlowKind } from "@/components/colony/parts";
import { FURS, RatBody, ZONE_LOOK } from "@/components/colony/ratArt";
import { ZoneBand } from "@/components/colony/ZoneBand";
import { cx } from "@/components/ui/kit";
import { GLYPH_IDS, ResGlyph, ResGlyphDefs, type GlyphId } from "@/components/ui/ResGlyph";

type Mood = "ok" | "idle" | "nosteam";
type Tod = "day" | "dusk" | "night";

const MOODS: [Mood, string][] = [
  ["ok", "Работает"],
  ["idle", "💤 Простой"],
  ["nosteam", "Нет пара"],
];
const TODS: [Tod, string][] = [
  ["day", "☀ День"],
  ["dusk", "🌆 Сумерки"],
  ["night", "🌙 Ночь"],
];
/** Game time for each human hour (humanClock: 05:00 at t = 0, five human seconds per real one). */
const TOD_TIME: Record<Tod, number> = { day: (12 * 60 - 300) * 12, dusk: (19 * 60 - 300) * 12, night: (23 * 60 + 30 - 300) * 12 };
/** A tint over the art for the time of day (the chambers are lit by their own lamps; the street sets the mood). */
const TOD_TINT: Record<Tod, string | null> = { day: null, dusk: "rgba(90,50,110,.22)", night: "rgba(8,14,40,.42)" };
const ZONE_GLOW: Record<ZoneId, GlowKind> = { burrow: "warm", sewers: "teal", cellars: "warm", metro: "red", terminal: "gold" };
const INK = "#1a120c";

/** The private state the art reads from the store: every zone open, the chosen hour and motion setting. */
function galleryGame(tod: Tod, calm: boolean): GameState {
  const s = createInitialState(7, 0);
  for (const z of ZONE_ORDER) s.zones[z] = true;
  s.time = TOD_TIME[tod];
  s.settings.reducedMotion = calm;
  return s;
}

const t0 = typeof performance !== "undefined" ? performance.now() : 0;

export default function ArtGallery() {
  const [mood, setMood] = useState<Mood>("ok");
  const [calm, setCalm] = useState(false);
  const [tod, setTod] = useState<Tod>("day");
  const timeRef = useRef<HTMLSpanElement>(null);
  // the chambers first (the measured part), the zone bands, rats and glyphs a moment later
  const [rest, setRest] = useState(false);

  useEffect(() => {
    useGame.setState({ game: galleryGame(tod, calm) });
  }, [tod, calm]);
  // the one motion switch the game uses (html[data-motion]) — so data-decor loops stop here too
  useEffect(() => {
    const html = document.documentElement;
    const before = html.dataset.motion;
    html.dataset.motion = calm ? "off" : "on";
    return () => {
      if (before === undefined) delete html.dataset.motion;
      else html.dataset.motion = before;
    };
  }, [calm]);
  // how long until every chamber is in the document (the acceptance: < 2 s in dev); the first paint follows
  useEffect(() => {
    const ms = Math.round(performance.now() - t0);
    const page = Math.round(performance.now());
    (window as unknown as { __rrArtMs?: { render: number; sincePageStart: number } }).__rrArtMs = { render: ms, sincePageStart: page };
    if (timeRef.current) {
      timeRef.current.textContent = `${document.querySelectorAll("[data-art-tile]").length} камер за ${ms} мс (${page} мс с начала загрузки)`;
    }
    const t = window.setTimeout(() => setRest(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  const tint = TOD_TINT[tod];
  return (
    <div className={cx("cv-root min-h-dvh bg-soot px-4 pb-16 pt-3 text-parchment", calm && "cv-rm")}>
      <style>{COLONY_CSS}</style>
      <ResGlyphDefs />
      <svg width="0" height="0" className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden>
        <defs>
          <Defs />
        </defs>
      </svg>

      <header className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-brass-dark/70 bg-soot-2/95 px-4 py-2 backdrop-blur-sm">
        <h1 className="font-display text-xl font-bold text-brass-light">🎨 Мастерская художника</h1>
        <Seg label="Настроение камер" value={mood} options={MOODS} onChange={setMood} />
        <Seg label="Время суток" value={tod} options={TODS} onChange={setTod} />
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={calm} onChange={(e) => setCalm(e.target.checked)} className="h-4 w-4 accent-[var(--brass)]" />
          Меньше движения
        </label>
        <span ref={timeRef} className="ml-auto font-mono text-xs text-parchment-dim">
          рисуем…
        </span>
      </header>

      <Section title={`Камеры: ${BUILDING_ORDER.length} построек × ${VISUAL_TIERS.length} ступеней`}>
        <div className="space-y-3">
          {BUILDING_ORDER.map((id) => (
            <BuildingRow key={id} id={id} mood={mood} tint={tint} />
          ))}
        </div>
      </Section>

      {rest && (
        <>
          <Section title="Полосы зон, 1:1">
            <div className="space-y-4">
              {ZONE_ORDER.map((z) => (
                <figure key={z} className="overflow-x-auto rounded-md border border-line">
                  <figcaption className="px-2 py-1 font-display text-sm font-bold text-brass-light">
                    {ZONES[z].icon} {ZONES[z].name}
                  </figcaption>
                  <div className="relative" style={{ width: COLONY_W, height: BAND_H }}>
                    <svg viewBox={`0 ${bandTop(z)} ${COLONY_W} ${BAND_H}`} width={COLONY_W} height={BAND_H} className="block">
                      <ZoneBand zone={z} />
                    </svg>
                    {tint && <div className="pointer-events-none absolute inset-0" style={{ background: tint }} />}
                  </div>
                </figure>
              ))}
            </div>
          </Section>

          <Section title="Крысы: каждая работа и облик зоны">
            <div className="flex flex-wrap gap-2">
              {JOB_IDS.map((j, i) => (
                <RatTile key={j} label={JOBS[j].name}>
                  <RatBody job={j} fur={FURS[i % FURS.length]} />
                </RatTile>
              ))}
              <RatTile label="Бригадир">
                <RatBody job="idle" fur={FURS[0]} foreman />
              </RatTile>
              {ZONE_ORDER.filter((z) => ZONE_LOOK[z]).map((z, i) => (
                <RatTile key={z} label={`Житель: ${ZONES[z].name}`}>
                  <RatBody job="idle" fur={FURS[(i + 2) % FURS.length]} zoneLook={z} />
                </RatTile>
              ))}
            </div>
          </Section>

          <Section title="Нарисованные значки (ResGlyph)">
            <div className="flex flex-wrap gap-2">
              {GLYPH_IDS.map((g) => (
                <figure key={g} className="flex w-28 flex-col items-center gap-1 rounded-md border border-line bg-panel/70 p-2">
                  <span className="flex items-end gap-2">
                    <ResGlyph id={g} className="text-[16px]" />
                    <ResGlyph id={g} className="text-[24px]" />
                    <ResGlyph id={g} className="text-[48px]" />
                  </span>
                  <figcaption className="text-center text-[11px] leading-tight text-parchment-dim">{glyphName(g)}</figcaption>
                </figure>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function glyphName(g: GlyphId): string {
  if (g === "fog") return "Туман";
  if (g.startsWith("zone-")) return ZONES[g.slice(5) as ZoneId].name;
  return RESOURCES[g as keyof typeof RESOURCES].name;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 border-b border-line pb-1 font-display text-lg font-bold text-brass">{title}</h2>
      {children}
    </section>
  );
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-brass-dark/70">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cx("min-h-10 px-2.5 text-xs font-bold", value === v ? "bg-brass/25 text-brass-light" : "bg-panel text-parchment-dim hover:bg-panel-3")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const BuildingRow = memo(function BuildingRow({ id, mood, tint }: { id: BuildingId; mood: Mood; tint: string | null }) {
  const def = BUILDINGS[id];
  return (
    <div className="flex items-start gap-3">
      <div className="w-36 shrink-0 pt-2 text-sm leading-tight">
        <span className="mr-1">{def.icon}</span>
        <b className="text-parchment">{def.name}</b>
        <span className="block font-mono text-[11px] text-parchment-dim">
          {id} · {ZONES[def.zone].name}
        </span>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-5 gap-2">
        {VISUAL_TIERS.map((lv) => (
          <ChamberTile key={lv} id={id} level={lv} mood={mood} tint={tint} />
        ))}
      </div>
    </div>
  );
});

/** One niche as the colony draws it (niche, zone glow, floor lip, the art), with the mood's marks and the level. */
const ChamberTile = memo(function ChamberTile({ id, level, mood, tint }: { id: BuildingId; level: number; mood: Mood; tint: string | null }) {
  const zone = BUILDINGS[id].zone;
  const pal = ZONES[zone].palette;
  const lvl = artLevel(id, level);
  const dim = mood !== "ok";
  return (
    <figure data-art-tile="" className="relative overflow-hidden rounded-md border border-line" style={{ background: shade(pal.bg, -0.1) }}>
      <svg viewBox="-94 -164 188 172" className="block h-auto w-full" role="img" aria-label={`${BUILDINGS[id].name}, ступень ${level}`}>
        <path d={NICHE} fill={shade(pal.bg, -0.55)} stroke={shade(pal.detail, 0.15)} strokeWidth="2" strokeOpacity=".55" />
        <Glow x={0} y={-36} r={96} kind={ZONE_GLOW[zone]} opacity={dim ? 0.08 : 0.3} />
        <rect x="-86" y="-6" width="172" height="6" fill={shade(pal.bg, 0.1)} opacity=".55" />
        <g className={dim ? "cv-idle" : undefined}>
          <BuildingArt id={id} lvl={lvl} />
        </g>
        {mood === "idle" && (
          <g transform="translate(-66 -12)">
            <rect x="-11" y="-9" width="22" height="17" rx="4" fill="#1b1613" stroke="#5c4520" strokeWidth=".9" />
            <text x="0" y="4" fontSize="11" textAnchor="middle">
              💤
            </text>
          </g>
        )}
        {mood === "nosteam" && (
          <g transform="translate(0 -142)">
            <path d="M0 0V10" stroke="#3a2a1a" strokeWidth="1.4" />
            <rect x="-31" y="10" width="62" height="17" rx="2.5" fill="#c4453a" stroke={INK} strokeWidth="1" />
            <text x="0" y="22" fontSize="9.5" textAnchor="middle" fill="#fff1e0" className="font-display" fontWeight="700">
              НЕТ ПАРА
            </text>
          </g>
        )}
        <g transform="translate(66 -12)">
          <rect x="-12" y="-8" width="24" height="15" rx="3" fill="url(#cv-brass)" stroke={INK} strokeWidth=".9" />
          <text x="0" y="3.4" fontSize="9.5" textAnchor="middle" fill="#2a1a0c" className="font-mono" fontWeight="700">
            {level}
          </text>
        </g>
      </svg>
      {tint && <div className="pointer-events-none absolute inset-0" style={{ background: tint }} />}
    </figure>
  );
});

function RatTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="flex w-32 flex-col items-center rounded-md border border-line bg-panel/70 p-1">
      <svg viewBox="-36 -34 62 38" width="124" height="76" aria-hidden>
        {children}
      </svg>
      <figcaption className="text-center text-[11px] leading-tight text-parchment-dim">{label}</figcaption>
    </figure>
  );
}
