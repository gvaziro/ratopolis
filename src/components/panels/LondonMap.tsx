"use client";

/**
 * London on the «Переселение» masthead (PAN-2): the Thames, the roads between neighbouring districts, the twelve
 * districts at DISTRICTS[id].pos (walked ones inked), the colony's route with arrows, a crown pin on the current
 * district and the next migration's choices. Names are HTML laid over the SVG (10.5 px at any width; offsets in cqw,
 * since 1 map unit = 1% of the width). A tap on a district names its landmark and trait; while the migration card is
 * open a tap on a choice picks it. Props are primitives, so the 3 Hz model of the tab does not re-render it.
 */
import { memo, useState } from "react";
import { DISTRICT_ORDER, DISTRICTS, districtInfoOf, type DistrictId } from "@/game/data/districts";
import { cx } from "@/components/ui/kit";
import { MAP_H, MAP_W, MARK_TEXT, ROADS, THAMES_PATH, districtMarks, districtXY, labelSide, labelTransform, mapXY, routeLegs, type DistrictMark } from "./londonGeo";

const INK = "#2a2018";
const PAPER = "#efe4c9";
const RED = "#a23a2c";
const GREEN = "#2d5f53";

const LABEL_TONE: Record<DistrictMark, string> = {
  here: "text-[#7a2620]",
  option: "text-[#2d5f53]",
  visited: "text-soot",
  past: "text-soot/75",
  ahead: "text-soot/60",
};

/** Hyde Park and Regent's Park, in district coordinates (decoration). */
const PARKS = [
  { x: 12, y: 41, rx: 5.2, ry: 2.4 },
  { x: 29, y: 15, rx: 3.4, ry: 2.4 },
];

export interface LondonMapProps {
  /** meta.visited joined by commas (the whole route, the current run last). */
  routeKey: string;
  /** meta.district: the current run's index in the route. */
  district: number;
  /** migrationPreview().options ids joined by commas. */
  optionsKey: string;
  /** The destination picked on the open migration card (drawn red), null while it is closed. */
  dest: DistrictId | null;
  /** Rings round the choices breathe (the migration is ready and motion is on). */
  pulse: boolean;
  /** Lap of London the next run walks (the trait shown for districts other than the current one). */
  nextLap: number;
  /** Lap of the current run. */
  lap: number;
  onDest?: (id: DistrictId) => void;
}

export default memo(function LondonMap({ routeKey, district, optionsKey, dest, pulse, nextLap, lap, onDest }: LondonMapProps) {
  const visited = (routeKey ? routeKey.split(",") : []) as DistrictId[];
  const options = (optionsKey ? optionsKey.split(",") : []) as DistrictId[];
  const marks = districtMarks(visited, district, options);
  const legs = routeLegs(visited, district);
  const here = DISTRICT_ORDER.find((id) => marks[id] === "here") ?? "whitechapel";
  const hereXY = districtXY(here);
  const [info, setInfo] = useState<DistrictId | null>(null);

  const tap = (id: DistrictId) => {
    setInfo((v) => (v === id && !(onDest && marks[id] === "option") ? null : id));
    if (onDest && marks[id] === "option") onDest(id);
  };

  return (
    <figure className="mt-2">
      <div className="relative w-full" style={{ aspectRatio: `${MAP_W} / ${MAP_H}`, containerType: "inline-size" }}>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {/* the paper: a faint graticule of an old survey map */}
          <g stroke={INK} strokeOpacity=".08" strokeWidth=".25">
            {[20, 40, 60, 80].map((x) => (
              <line key={`v${x}`} x1={x} y1="0" x2={x} y2={MAP_H} />
            ))}
            {[14.5, 29, 43.5].map((y) => (
              <line key={`h${y}`} x1="0" y1={y} x2={MAP_W} y2={y} />
            ))}
          </g>
          {PARKS.map((p) => {
            const c = mapXY(p);
            return <ellipse key={`${p.x}`} cx={c.x} cy={c.y} rx={p.rx} ry={p.ry} fill="#7f8f58" fillOpacity=".28" stroke="#5d6b3c" strokeOpacity=".35" strokeWidth=".25" />;
          })}
          {/* the Thames */}
          <path d={THAMES_PATH} fill="none" stroke="#6b5a42" strokeOpacity=".55" strokeWidth="5.2" strokeLinecap="round" />
          <path d={THAMES_PATH} fill="none" stroke="#98b0b0" strokeWidth="4.2" strokeLinecap="round" />
          <path d={THAMES_PATH} fill="none" stroke="#d5e0da" strokeOpacity=".7" strokeWidth=".35" strokeDasharray="2.4 3.2" />
          {/* roads between neighbours: where one migration can lead */}
          <g stroke={INK} strokeOpacity=".3" strokeWidth=".3" strokeDasharray=".9 1.1">
            {ROADS.map(([a, b]) => {
              const p = districtXY(a);
              const q = districtXY(b);
              return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
            })}
          </g>
          {/* the colony's route; earlier laps faint */}
          {legs.map((l, i) => (
            <Leg key={i} from={l.from} to={l.to} color={INK} opacity={l.lap ? 0.9 : 0.25} width={l.lap ? 0.75 : 0.5} arrow={l.lap} />
          ))}
          {/* the next migration's choices */}
          {options.map((id) =>
            id === here ? null : (
              <Leg key={`o-${id}`} from={here} to={id} color={id === dest ? RED : GREEN} opacity={id === dest ? 0.95 : 0.7} width={id === dest ? 0.8 : 0.5} dash={id === dest ? "1.6 .8" : "1.2 1"} arrow={id === dest} />
            ),
          )}
          {DISTRICT_ORDER.map((id) => {
            const mk = marks[id];
            if (mk === "here") return null;
            const { x, y } = districtXY(id);
            const chosen = id === dest;
            return (
              <g key={id}>
                {mk === "option" &&
                  (pulse ? (
                    <circle cx={x} cy={y} r="1.6" fill="none" stroke={chosen ? RED : GREEN} strokeWidth=".45" className="rr-map-ping" data-decor="" />
                  ) : (
                    <circle cx={x} cy={y} r="2.7" fill="none" stroke={chosen ? RED : GREEN} strokeWidth=".35" strokeDasharray=".8 .6" />
                  ))}
                <circle
                  cx={x}
                  cy={y}
                  r={mk === "ahead" || mk === "past" ? 1.35 : 1.55}
                  fill={mk === "visited" ? INK : mk === "past" ? "#8a7a62" : chosen ? RED : PAPER}
                  stroke={mk === "option" ? (chosen ? RED : GREEN) : INK}
                  strokeOpacity={mk === "ahead" ? 0.7 : 1}
                  strokeWidth={mk === "option" ? 0.55 : 0.35}
                />
                {id === info && <circle cx={x} cy={y} r="3" fill="none" stroke="#b8862b" strokeWidth=".45" />}
              </g>
            );
          })}
          {/* the crown pin: the colony lives here */}
          <g transform={`translate(${hereXY.x} ${hereXY.y})`}>
            {here === info && <circle r="3" fill="none" stroke="#b8862b" strokeWidth=".45" />}
            <circle r="1.1" fill={INK} />
            <path d="M0 0L-1.25 -3.3A2.3 2.3 0 1 1 1.25 -3.3Z" fill={RED} stroke={INK} strokeWidth=".3" strokeLinejoin="round" />
            <path d="M-1.3 -4.3L-1.3 -6.1L-.65 -5.3L0 -6.5L.65 -5.3L1.3 -6.1L1.3 -4.3Z" fill="#f2c14e" stroke={INK} strokeWidth=".2" strokeLinejoin="round" />
          </g>
          {/* compass: the dark arm points north */}
          <g transform={`translate(${MAP_W - 4} 5)`} fill={INK} fillOpacity=".55">
            <path d="M0 -3.2L.7 -.7L0 0L-.7 -.7Z" />
            <path d="M0 3.2L.7 .7L0 0L-.7 .7Z" fillOpacity=".35" />
            <path d="M3.2 0L.7 .7L0 0L.7 -.7Z" fillOpacity=".35" />
            <path d="M-3.2 0L-.7 .7L0 0L-.7 -.7Z" fillOpacity=".35" />
          </g>
        </svg>

        {DISTRICT_ORDER.map((id) => {
          const { x, y } = districtXY(id);
          const mk = marks[id];
          const left = `${(x / MAP_W) * 100}%`;
          const top = `${(y / MAP_H) * 100}%`;
          const name = DISTRICTS[id].name;
          return (
            <span key={id}>
              <span
                aria-hidden
                className={cx(
                  "pointer-events-none absolute whitespace-nowrap text-[10.5px] font-bold leading-none [text-shadow:0_0_2px_#efe4c9,0_0_2px_#efe4c9,0_0_3px_#efe4c9]",
                  id === dest ? "text-[#a23a2c]" : LABEL_TONE[mk],
                  (mk === "here" || id === dest) && "underline decoration-[1.5px] underline-offset-2",
                )}
                style={{ left, top, transform: labelTransform(labelSide(id, here), mk === "here") }}
              >
                {name}
              </span>
              <button
                type="button"
                onClick={() => tap(id)}
                aria-label={`${name}: ${MARK_TEXT[mk]}${id === dest ? ", выбран для переселения" : ""}`}
                aria-pressed={id === info}
                className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-2 focus-visible:outline-[#b8862b]"
                style={{ left, top }}
              />
            </span>
          );
        })}
      </div>
      <figcaption className="mt-1.5 min-h-[2.4rem] border-t border-soot/25 pt-1 text-[11px] leading-snug">
        {info ? <DistrictLine id={info} mark={marks[info]} lap={marks[info] === "here" ? lap : nextLap} picked={info === dest} /> : <Legend choose={!!onDest} />}
      </figcaption>
    </figure>
  );
});

/** One leg of a route: a line between two districts, an arrow at its middle. */
function Leg({ from, to, color, opacity, width, dash, arrow }: { from: DistrictId; to: DistrictId; color: string; opacity: number; width: number; dash?: string; arrow?: boolean }) {
  const p = districtXY(from);
  const q = districtXY(to);
  const deg = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  return (
    <g stroke={color} strokeOpacity={opacity} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} strokeWidth={width} strokeDasharray={dash} />
      {arrow && <path d="M-1 -.9L.7 0L-1 .9" strokeWidth={width} transform={`translate(${mx} ${my}) rotate(${deg})`} />}
    </g>
  );
}

function Legend({ choose }: { choose: boolean }) {
  const dot = (fill: string, stroke: string) => <span aria-hidden className="inline-block h-2 w-2 rounded-full border" style={{ background: fill, borderColor: stroke }} />;
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px] text-soot/80">
      <span className="inline-flex items-center gap-1">{dot(INK, INK)} пройден</span>
      <span className="inline-flex items-center gap-1">{dot(PAPER, GREEN)} можно уйти</span>
      <span className="inline-flex items-center gap-1">{dot(PAPER, INK)} впереди</span>
      <span className="italic">{choose ? "коснитесь района, чтобы выбрать" : "коснитесь района"}</span>
    </p>
  );
}

function DistrictLine({ id, mark, lap, picked }: { id: DistrictId; mark: DistrictMark; lap: number; picked: boolean }) {
  const def = DISTRICTS[id];
  const info = districtInfoOf(id, lap);
  const t = info.trait;
  return (
    <>
      <p>
        {def.icon} <b>{info.name}</b> · {def.landmark} — <span className={cx(mark === "option" && "font-bold text-[#2d5f53]", mark === "here" && "font-bold text-[#7a2620]")}>{picked ? "выбран для переселения" : MARK_TEXT[mark]}</span>
      </p>
      <p className="text-soot/80">
        {t.icon} {t.name}: {t.perk} · {t.quirk}
      </p>
    </>
  );
}
