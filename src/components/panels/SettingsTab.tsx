"use client";

/**
 * ⚙ Настройки: sound with a master volume and the effects / background / music buses (v3), motion («как в системе»), hints, train toasts, number format,
 * text size, the hotkey list, save export/import (string or .txt file),
 * a rollback to the rolling backups, «Сохранить сейчас», a doubly-confirmed hard reset, and a short «Об игре».
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { sfx } from "@/audio/sfx";
import { useGame, type BackupInfo } from "@/game/store";
import type { BatterySaver, Settings, TextScale } from "@/game/types";
import { clockAt, datedSaveName, downloadText, ratsLabel } from "@/components/ui/crashKit";
import { BrassButton, cx } from "@/components/ui/kit";
import { useEco } from "@/lib/eco";
import { fmtInt } from "@/lib/format";
import { SectionTitle, Segmented, Switch, type SegOption } from "./common";

export default function SettingsTab() {
  return (
    <div className="pb-2">
      <h2 className="font-display text-lg font-bold tracking-wide text-brass-light">
        <span className="mr-1.5">⚙</span>Настройки
      </h2>
      <p className="text-xs italic text-parchment-dim">Контора колонии. Здесь крутят ручки, а не хвосты.</p>
      <SoundSection />
      <ViewSection />
      <KeysSection />
      <SaveSection />
      <ResetSection />
      <About />
    </div>
  );
}

function useSetting<K extends keyof Settings>(key: K): [Settings[K], (v: Settings[K]) => void] {
  const value = useGame((s) => s.game.settings[key]);
  return [value, (v) => useGame.getState().setSetting(key, v)];
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-lg border border-line bg-gradient-to-b from-panel-2/80 to-panel/80 p-2.5 shadow-[inset_0_1px_0_rgba(232,201,131,.06)]", className)}>{children}</div>;
}

/* ------------------------------------------------------------ sound */

/**
 * The v3 mixer's live previews (AUD-3). Optional: until the audio package ships them, the sliders still save their
 * value and AudioDirector applies it from the settings.
 */
const mixer = sfx as typeof sfx & { setSfxVolume?: (v: number) => void; setMusic?: (v: number) => void };

function SoundSection() {
  const [sound, setSound] = useSetting("sound");
  const [volume, setVolume] = useSetting("volume");
  const [effects, setEffects] = useSetting("sfxVolume");
  const [ambience, setAmbience] = useSetting("ambience");
  const [music, setMusic] = useSetting("music");

  return (
    <>
      <SectionTitle>Звук</SectionTitle>
      <Card className="space-y-1">
        <Switch
          on={sound}
          onToggle={() => {
            sfx.unlock();
            sfx.setVolume(volume, !sound);
            setSound(!sound);
            if (!sound) sfx.tin();
          }}
          label="Звук"
          sub="Писк, звон монет, гул поездов — всё синтезировано прямо в колонии"
        />
        {/* v3 SHL-6 (audio-9): «Громкость» is the master; effects, background and music each have their own bus */}
        <Slider
          id="rr-volume"
          label="Громкость"
          sub="Всё сразу"
          value={volume}
          disabled={!sound}
          onLive={(v) => sfx.setVolume(v, sound)}
          onCommit={setVolume}
          onDone={() => sound && sfx.tin()}
        />
        <Slider
          id="rr-sfx"
          label="Эффекты"
          sub="Клики, монеты, поезда"
          value={effects}
          disabled={!sound}
          onLive={(v) => mixer.setSfxVolume?.(v)}
          onCommit={setEffects}
          onDone={() => sound && sfx.tin()}
        />
        <Slider id="rr-ambience" label="Фон" sub="Капель, гул поездов вдали, тиканье часов" value={ambience} disabled={!sound} onLive={(v) => sfx.setAmbience(v)} onCommit={setAmbience} />
        <Slider
          id="rr-music"
          label="Музыка"
          sub="Шарманка и музыкальная шкатулка района"
          value={music}
          disabled={!sound}
          onLive={(v) => mixer.setMusic?.(v)}
          onCommit={setMusic}
        />
      </Card>
    </>
  );
}

/**
 * A brass 0–100% slider: plays along live (onLive), commits to the save at most ~8 times a second while dragging
 * (each commit clones the game state) and once more on release.
 */
function Slider({
  id,
  label,
  sub,
  value,
  disabled,
  onLive,
  onCommit,
  onDone,
}: {
  id: string;
  label: string;
  sub?: string;
  value: number;
  disabled: boolean;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
  onDone?: () => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const timer = useRef(0);
  const shown = drag ?? value;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const schedule = (v: number) => {
    pending.current = v;
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      if (pending.current !== null) onCommit(pending.current);
    }, 120);
  };
  const finish = () => {
    if (drag === null) return;
    window.clearTimeout(timer.current);
    timer.current = 0;
    onCommit(drag);
    setDrag(null);
    onDone?.();
  };
  return (
    <div className={cx("px-1", disabled && "opacity-50")}>
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="font-bold text-parchment">
          {label}
          {sub && <span className="ml-1.5 font-normal text-parchment-dim">{sub}</span>}
        </label>
        <span className="font-mono tabular text-brass-light">{Math.round(shown * 100)}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(shown * 100)}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value) / 100;
          setDrag(v);
          onLive(v);
          schedule(v);
        }}
        onPointerUp={finish}
        onKeyUp={finish}
        onBlur={finish}
        className="rr-range block w-full disabled:cursor-not-allowed"
        style={{ "--pct": `${Math.round(shown * 100)}%`, accentColor: "var(--brass)" } as CSSProperties}
      />
    </div>
  );
}

/* ------------------------------------------------------------ view */

const TEXT_SCALES: SegOption<TextScale>[] = [
  { value: 1, label: "100%" },
  { value: 1.15, label: "115%" },
  { value: 1.3, label: "130%" },
];

const SAVERS: SegOption<BatterySaver>[] = [
  { value: "auto", label: "Авто" },
  { value: "on", label: "Вкл" },
  { value: "off", label: "Выкл" },
];

function ViewSection() {
  const [saver, setSaver] = useSetting("batterySaver");
  const eco = useEco();
  const [reduced, setReduced] = useSetting("reducedMotion");
  const fromOS = useGame((s) => s.game.settings.reducedMotionFromOS);
  const [noShake, setNoShake] = useSetting("noShake");
  const [toasts, setToasts] = useSetting("trainToasts");
  const [sci, setSci] = useSetting("sciNotation");
  const [hints, setHints] = useSetting("hints");
  const [scale, setScale] = useSetting("textScale");
  return (
    <>
      <SectionTitle>Экран</SectionTitle>
      <Card className="grid gap-0.5">
        <Switch
          on={reduced}
          onToggle={() => setReduced(!reduced)}
          label="Меньше движения"
          sub={`Без тряски, зума и вспышек; частиц на 70% меньше${fromOS ? " · как в системе" : ""}`}
        />
        <Switch
          on={noShake || reduced}
          disabled={reduced}
          onToggle={() => setNoShake(!noShake)}
          label="Без тряски"
          sub={reduced ? "Уже включено вместе с «Меньше движения»" : "Экран не дрожит от поездов и раскопок"}
        />
        <Switch on={hints} onToggle={() => setHints(!hints)} label="Подсказки" sub="Совет старейшины в «Целях колонии» с кнопкой «Сделать»" />
        <Switch on={toasts} onToggle={() => setToasts(!toasts)} label="Тосты «К путям!»" sub={"Колокольчик и напоминание за 30 с до поезда"} />
        <Switch
          on={sci}
          onToggle={() => setSci(!sci)}
          label="Научный формат чисел"
          sub={sci ? "Сейчас: 1.23e45 — для учёных крыс" : "Сейчас: 1.23K, 4.5M, 6.7Qa — для простых крыс"}
        />
        <div className="flex items-center justify-between gap-2 px-1 py-1.5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-parchment">Размер текста</p>
            <p className="text-[11px] leading-tight text-parchment-dim">Панель, шапка, ресурсы и лента новостей</p>
          </div>
          <Segmented label="Размер текста" value={scale} options={TEXT_SCALES} onChange={setScale} />
        </div>
        <div className="flex items-center justify-between gap-2 px-1 py-1.5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-parchment">Экономия батареи</p>
            <p className="text-[11px] leading-tight text-parchment-dim">
              {eco ? "Сейчас включена: свечи и шестерёнки замирают, колония рисуется реже, телефон не греется" : "Сейчас выключена: вся анимация в полную силу"}
              {saver === "auto" && " · «Авто» включает её на телефонах и планшетах"}
            </p>
          </div>
          <Segmented label="Экономия батареи" value={saver} options={SAVERS} onChange={setSaver} />
        </div>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ keys */

const KEYS: [string, string][] = [
  ["1–8", "вкладки панели по порядку"],
  ["B", "покупка: ×1 → ×10 → Макс"],
  ["G / Enter", "клик по решётке"],
  ["M", "звук вкл/выкл"],
  ["Esc", "закрыть подсказки, ленту и лавку"],
  ["← → / пробел", "лапа в сцене поезда; 1 / 2 — выбор при Коте и Крысолове"],
];

function KeysSection() {
  return (
    <>
      <SectionTitle>Клавиши</SectionTitle>
      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {KEYS.map(([k, what]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-brass-dark/80 bg-soot px-1.5 py-0.5 font-mono text-[11px] text-brass-light">{k}</kbd>
              </dt>
              <dd className="text-parchment-dim">{what}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
/* ------------------------------------------------------------ saves */

type Note = { ok: boolean; text: string } | null;

function SaveSection() {
  const lastSaved = useGame((s) => s.game.lastSaved);
  const [saveNote, setSaveNote] = useState<Note>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<Note>(null);
  const [importText, setImportText] = useState("");
  const [importNote, setImportNote] = useState<Note>(null);
  const exportRef = useRef<HTMLTextAreaElement>(null);

  const saveNow = () => {
    // false: storage blocked or full (or saving paused by an open save issue)
    const ok = useGame.getState().save();
    setSaveNote(
      ok
        ? { ok: true, text: `Сохранено в ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. Летопись в безопасности.` }
        : { ok: false, text: "Браузер не даёт записать летопись — скачайте файл сохранения ниже." },
    );
  };

  const doExport = () => {
    setExported(useGame.getState().exportSave());
    setCopyNote(null);
    requestAnimationFrame(() => exportRef.current?.select());
  };

  const copy = async () => {
    if (!exported) return;
    try {
      await navigator.clipboard.writeText(exported);
      setCopyNote({ ok: true, text: "Скопировано! Храните в сухом месте, подальше от котов." });
    } catch {
      const ta = exportRef.current;
      if (ta) {
        ta.focus();
        ta.select();
        const ok = document.execCommand?.("copy") ?? false;
        setCopyNote(ok ? { ok: true, text: "Скопировано!" } : { ok: false, text: "Буфер обмена заперт. Выделите текст и скопируйте вручную (Ctrl+C)." });
      }
    }
  };

  const doImport = () => {
    const str = importText.trim();
    if (!str) {
      setImportNote({ ok: false, text: "Вставьте строку сохранения — пустой свиток не прочесть." });
      return;
    }
    const ok = useGame.getState().importSave(str);
    if (ok) {
      setImportText("");
      setImportNote({ ok: true, text: "Летопись прочитана! Колония восстановлена из сохранения." });
    } else {
      setImportNote({ ok: false, text: "Не похоже на крысиную летопись. Проверьте, что строка скопирована целиком." });
    }
  };

  const lastLine = lastSaved > 0 ? new Date(lastSaved).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  return (
    <>
      <SectionTitle>Сохранения</SectionTitle>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <BrassButton onClick={saveNow} className="min-h-10">
            💾 Сохранить сейчас
          </BrassButton>
          <span className="text-[11px] leading-tight text-parchment-dim">
            Автосохранение каждые 15&nbsp;с.
            <br />
            Последнее: <span className="font-mono tabular">{lastLine}</span>
          </span>
        </div>
        <NoteLine note={saveNote} />

        <div className="space-y-1.5 border-t border-line/70 pt-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <BrassButton tone="ghost" onClick={doExport} className="min-h-10">
              📤 Экспорт
            </BrassButton>
            {exported && (
              <BrassButton tone="verdigris" onClick={copy} className="min-h-10">
                📋 Копировать
              </BrassButton>
            )}
          </div>
          {exported && (
            <textarea
              ref={exportRef}
              readOnly
              value={exported}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
              className="block w-full resize-none break-all rounded-md border border-line bg-soot/80 p-2 font-mono text-[10.5px] leading-snug text-parchment-dim focus:border-brass-dark"
              aria-label="Строка сохранения"
            />
          )}
          <NoteLine note={copyNote} />
        </div>

        <div className="space-y-1.5 border-t border-line/70 pt-2.5">
          <label htmlFor="rr-import" className="block text-xs font-bold text-parchment">
            📥 Импорт
          </label>
          <textarea
            id="rr-import"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={3}
            placeholder="Вставьте сюда строку сохранения…"
            className="block w-full resize-none break-all rounded-md border border-line bg-soot/80 p-2 font-mono text-[10.5px] leading-snug text-parchment placeholder:text-muted focus:border-brass-dark"
          />
          <div className="flex flex-wrap items-center gap-2">
            <BrassButton tone="copper" onClick={doImport} disabled={!importText.trim()} className="min-h-10">
              Загрузить
            </BrassButton>
            <span className="text-[11px] leading-tight text-parchment-dim">Текущая колония будет заменена.</span>
          </div>
          <NoteLine note={importNote} />
        </div>

        <SaveFiles />
        <Rollback />
      </Card>
    </>
  );
}

/** «Скачать файл» / «Загрузить файл»: the save as a plain .txt (the stored JSON) and back (JSON or «RATRO1:…»). */
function SaveFiles() {
  const [note, setNote] = useState<Note>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const download = () => {
    const st = useGame.getState();
    st.save();
    const text = st.rawSave() ?? st.exportSave();
    setNote(
      downloadText(datedSaveName(), text)
        ? { ok: true, text: "Свиток отправлен в «Загрузки». Храните в сухом месте, подальше от котов." }
        : { ok: false, text: "Браузер не дал скачать файл. Попробуйте «Экспорт» строкой." },
    );
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      setNote({ ok: false, text: "Слишком толстый свиток — это точно летопись колонии?" });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setNote({ ok: false, text: "Файл не открылся: свиток слипся." });
      return;
    }
    const ok = useGame.getState().importSaveFile(text.trim());
    setNote(
      ok
        ? { ok: true, text: `Летопись «${file.name}» прочитана! Прежняя колония спрятана в запасную копию.` }
        : { ok: false, text: "Не похоже на крысиную летопись: файл не читается." },
    );
  };

  return (
    <div className="space-y-1.5 border-t border-line/70 pt-2.5">
      <div className="text-xs font-bold text-parchment">📁 Файл сохранения</div>
      <div className="flex flex-wrap items-center gap-2">
        <BrassButton tone="ghost" onClick={download} className="min-h-10">
          💾 Скачать файл
        </BrassButton>
        <BrassButton tone="copper" onClick={() => inputRef.current?.click()} className="min-h-10">
          📂 Загрузить файл
        </BrassButton>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.json,text/plain,application/json"
          className="hidden"
          aria-label="Файл сохранения"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = ""; // the same file can be picked again
            void load(file);
          }}
        />
      </div>
      <NoteLine note={note} />
    </div>
  );
}

/** «Откатить к копии»: the backups (the rolling 5-minute copy and the one kept from before an import or reset), newest first. */
function Rollback() {
  // every save may have refreshed the copies: re-read them then (cheap, ~every 15 s)
  useGame((s) => s.game.lastSaved);
  const backups = useGame.getState().backups();
  // the copy the player picked, by slot and save time: a copy refreshed meanwhile is another copy, and closes the question
  const [confirm, setConfirm] = useState<{ slot: BackupInfo["slot"]; at: number } | null>(null);
  const [note, setNote] = useState<Note>(null);

  const restore = (b: BackupInfo) => {
    const when = clockAt(b.at);
    setConfirm(null);
    // the slot may have been rewritten since this row was drawn: never restore a copy the player did not pick
    const still = useGame.getState().backups().some((x) => x.slot === b.slot && x.at === b.at);
    if (!still) {
      setNote({ ok: false, text: "Летописец как раз обновил копии — выберите ещё раз." });
      return;
    }
    // restoreBackup re-checks the slot's time itself (expectedAt) before touching anything
    setNote(
      useGame.getState().restoreBackup(b.slot, b.at)
        ? { ok: true, text: `Колония откатилась к копии от ${when}. Прежняя спрятана в копию — можно вернуть.` }
        : { ok: false, text: "Эта копия не читается. Попробуйте другую." },
    );
  };

  return (
    <div className="space-y-1.5 border-t border-line/70 pt-2.5">
      <div className="text-xs font-bold text-parchment">🕰 Откатить к копии</div>
      {backups.length === 0 ? (
        <p className="text-[11px] leading-snug text-parchment-dim">Копий пока нет: летописец делает их каждые 5 минут игры, а ещё перед импортом и сбросом.</p>
      ) : (
        <ul className="space-y-1">
          {backups.map((b) => (
            <li key={b.slot} className="flex flex-wrap items-center gap-2 rounded-md border border-line/70 bg-soot/40 px-2 py-1">
              <span className="min-w-0 flex-1 text-xs leading-tight text-parchment">
                <b className="font-mono tabular text-brass-light">{clockAt(b.at)}</b> · {ratsLabel(b.rats)}
                {b.crownsEver > 0 && <span className="text-gaslight"> · 👑 {fmtInt(b.crownsEver)}</span>}
                <span className="block text-[10.5px] text-parchment-dim">{b.slot === 1 ? "копия каждые 5 минут" : "до последнего импорта, отката или сброса"}</span>
              </span>
              {confirm?.slot === b.slot && confirm.at === b.at ? (
                <span className="flex gap-1.5">
                  <BrassButton tone="danger" size="sm" onClick={() => restore(b)} className="min-h-10">
                    Да, откатить
                  </BrassButton>
                  <BrassButton tone="ghost" size="sm" onClick={() => setConfirm(null)} className="min-h-10">
                    Нет
                  </BrassButton>
                </span>
              ) : (
                <BrassButton tone="verdigris" size="sm" onClick={() => setConfirm({ slot: b.slot, at: b.at })} className="min-h-10">
                  Откатить
                </BrassButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {backups.length > 0 && <p className="text-[11px] leading-snug text-parchment-dim">Нынешняя колония перед откатом сама уйдёт в копию — передумать можно.</p>}
      <NoteLine note={note} />
    </div>
  );
}

function NoteLine({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p role="status" className={cx("hud-pop text-xs leading-snug", note.ok ? "text-good" : "text-danger-light")}>
      {note.ok ? "✓ " : "✗ "}
      {note.text}
    </p>
  );
}

/* ------------------------------------------------------------ reset */

function ResetSection() {
  const [step, setStep] = useState<0 | 1>(0);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);
  const ready = typed.trim().toUpperCase() === "СБРОС";

  return (
    <>
      <SectionTitle>Опасная зона</SectionTitle>
      <Card className="border-danger/40">
        {step === 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <BrassButton
              tone="danger"
              onClick={() => {
                setStep(1);
                setDone(false);
              }}
              className="min-h-10"
            >
              🔥 Полный сброс…
            </BrassButton>
            <span className="text-[11px] leading-tight text-parchment-dim">Стирает всё: колонию, венцы, указы и медали.</span>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs leading-snug text-parchment">
              <b className="text-danger-light">Великое Зловоние навсегда.</b> Пропадут крысы, постройки, венцы, указы и медали. Вожак снова окажется один у решётки.
              Чтобы подтвердить, наберите <b className="font-mono text-danger-light">СБРОС</b>.
            </p>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="СБРОС"
              autoComplete="off"
              spellCheck={false}
              aria-label="Наберите СБРОС для подтверждения"
              className="block h-10 w-full rounded-md border border-danger/50 bg-soot/80 px-2 font-mono text-sm uppercase tracking-widest text-parchment placeholder:text-muted focus:border-danger-light"
            />
            <div className="flex flex-wrap gap-2">
              <BrassButton
                tone="danger"
                disabled={!ready}
                onClick={() => {
                  useGame.getState().hardReset();
                  setStep(0);
                  setTyped("");
                  setDone(true);
                }}
                className="min-h-10"
              >
                Стереть всё
              </BrassButton>
              <BrassButton
                tone="ghost"
                onClick={() => {
                  setStep(0);
                  setTyped("");
                }}
                className="min-h-10"
              >
                Передумал
              </BrassButton>
            </div>
          </div>
        )}
        {done && <NoteLine note={{ ok: true, text: "Колония стёрта. Где-то у решётки снова пищит одинокий вожак." }} />}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ about */

function About() {
  const controls: [string, string][] = [
    ["🖱️", "Клик или тап по решётке — тащить крошки"],
    ["👆", "Зажми и веди по падающим предметам — ловить (на телефоне — свайп)"],
    ["⎵", "Пробел — бросить крюк-кошку во время поезда"],
    ["✋", "Колонию можно двигать мышью или пальцем"],
  ];
  return (
    <>
      <SectionTitle right={<span className="font-mono text-[11px] text-parchment-dim">v1.0</span>}>Об игре</SectionTitle>
      <Card>
        <p className="font-display text-base font-bold leading-tight text-brass-light">Ratropolis Underground</p>
        <p className="text-xs italic text-parchment-dim">«Для людей это один день. Для крыс — целая история».</p>
        <ul className="mt-2 space-y-1">
          {controls.map(([icon, text]) => (
            <li key={text} className="flex items-start gap-2 text-xs leading-snug text-parchment">
              <span className="w-5 shrink-0 text-center" aria-hidden>
                {icon}
              </span>
              {text}
            </li>
          ))}
        </ul>
        <p className="mt-2 border-t border-line/70 pt-2 text-[11px] leading-snug text-parchment-dim">
          Сделано крысами под Лондоном. Ни одного внешнего файла: всё нарисовано кодом, а каждый писк синтезирован.
        </p>
      </Card>
    </>
  );
}
