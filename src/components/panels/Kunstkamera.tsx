"use client";

/**
 * «Кунсткамера Короля» (PAN-2, ENG-10): 24 things the humans keep losing, a shelf of four per owner (curioSets).
 * An owned curio shows its name, an empty slot its silhouette and where to look (CURIOS[id].hint); a tap opens the
 * 👤/🐀 pair (or the hint in full) under its shelf. A full set shows its perk. The «+X% ко всему» line is read from
 * derive's «Кунсткамера» part, so it appears only once the engine pays it. Sampled twice a second (PA-1).
 */
import { memo, useMemo, useState } from "react";
import { CURIOS, CURIO_ORDER, curioSets, type CurioId, type CurioSetView } from "@/game/data/curios";
import { derivedOf } from "@/game/store";
import type { GameState } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { cx } from "@/components/ui/kit";
import { pctText } from "./metaText";

interface KunstModel {
  sets: CurioSetView[];
  owned: number;
  /** «+X% ко всему» of derive's «Кунсткамера» part, null while the engine has no such part. */
  bonus: string | null;
}

function kunstModel(s: GameState): KunstModel {
  const sets = curioSets(s);
  const part = derivedOf(s).globalParts.find((p) => p.label === "Кунсткамера");
  return {
    sets,
    owned: sets.reduce((a, x) => a + x.items.filter((i) => i.owned).length, 0),
    bonus: part && part.mult > 1 ? pctText((part.mult - 1) * 100) : null,
  };
}

export default memo(function Kunstkamera() {
  const json = useSampled((s) => JSON.stringify(kunstModel(s.game)), 2, Object.is);
  const m = useMemo(() => JSON.parse(json) as KunstModel, [json]);
  const [sel, setSel] = useState<CurioId | null>(null);
  return (
    <>
      <p className="-mt-1 mb-2 text-[11px] leading-snug text-parchment-dim">
        Люди теряют — крысы хранят. Экспонатов: <b className="text-parchment">{m.owned}</b> из {CURIO_ORDER.length}
        {m.bonus && <span className="text-good"> · +{m.bonus}% ко всему</span>}. Диковины попадаются в поездах и событиях, не больше одной за раз; пойманная
        остаётся навсегда, упущенная ещё вернётся.
      </p>
      <div className="space-y-1.5">
        {m.sets.map((set) => (
          <Shelf key={set.owner} set={set} sel={sel} onPick={(id) => setSel((v) => (v === id ? null : id))} />
        ))}
      </div>
    </>
  );
});

function Shelf({ set, sel, onPick }: { set: CurioSetView; sel: CurioId | null; onPick: (id: CurioId) => void }) {
  const got = set.items.filter((i) => i.owned).length;
  const picked = set.items.find((i) => i.id === sel);
  return (
    <section
      aria-label={`${set.name}: ${got} из ${set.items.length}`}
      className={cx("rounded-md border p-1.5", set.done ? "border-gaslight/70 bg-gradient-to-b from-gaslight/10 to-transparent" : "border-line bg-black/15")}
    >
      <p className="mb-1 flex items-baseline justify-between gap-2 px-0.5">
        <span className={cx("min-w-0 truncate font-display text-[13px] font-bold", set.done ? "text-gaslight" : "text-parchment")}>
          {set.icon} {set.name}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular text-parchment-dim">
          {got}/{set.items.length}
        </span>
      </p>
      <div className="grid grid-cols-4 gap-1">
        {set.items.map((it) => (
          <CurioTile key={it.id} id={it.id} owned={it.owned} selected={it.id === sel} onPick={() => onPick(it.id)} />
        ))}
      </div>
      <p className={cx("mt-1 px-0.5 text-[11px] leading-snug", set.done ? "font-bold text-good" : "text-parchment-dim")}>
        {set.done ? `✓ Набор собран: ${set.perk}` : `За полный набор: ${set.perk}`}
      </p>
      {picked && <CurioLine id={picked.id} owned={picked.owned} />}
    </section>
  );
}

function CurioTile({ id, owned, selected, onPick }: { id: CurioId; owned: boolean; selected: boolean; onPick: () => void }) {
  const c = CURIOS[id];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      aria-label={owned ? c.name : `Пустая полка: ${c.hint}`}
      className={cx(
        "relative flex min-w-0 flex-col items-center gap-0.5 rounded-md border px-0.5 pb-1 pt-1.5 text-center",
        owned ? "border-brass-dark bg-gradient-to-b from-brass/15 to-panel" : "border-dashed border-line/80 bg-black/20",
        selected && "outline outline-2 outline-gaslight",
      )}
    >
      <span
        className={cx(
          "grid h-9 w-9 place-items-center rounded-full border-2 text-lg",
          owned ? "border-brass bg-gradient-to-b from-brass-light/30 to-brass-dark/30 shadow-[0_0_8px_rgba(242,184,75,.3)]" : "border-line bg-black/30",
        )}
      >
        <span className={cx(!owned && "rr-silhouette")}>{c.icon}</span>
      </span>
      <span lang="ru" className={cx("line-clamp-2 w-full break-words text-[10.5px] leading-[12px] hyphens-auto", owned ? "font-bold text-brass-light" : "italic text-parchment-dim")}>
        {owned ? c.name : c.hint}
      </span>
    </button>
  );
}

function CurioLine({ id, owned }: { id: CurioId; owned: boolean }) {
  const c = CURIOS[id];
  if (!owned)
    return (
      <p className="mt-1 rounded border border-line/60 bg-black/25 px-2 py-1 text-[11px] leading-snug text-parchment-dim">
        Пустая полка. 🔎 Где искать: <b className="text-parchment">{c.hint}</b>.
      </p>
    );
  return (
    <div className="mt-1 rounded border border-line/60 bg-black/25 px-2 py-1 text-[11px] leading-snug">
      <p className="font-bold text-brass-light">
        {c.icon} {c.name}
      </p>
      <p className="text-parchment-dim">
        👤 <i>«{c.human}»</i>
      </p>
      <p className="text-parchment">
        🐀 <i>«{c.rat}»</i>
      </p>
    </div>
  );
}
