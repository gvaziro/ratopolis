"use client";

/**
 * ⚙ Настройки: sound and volume, motion, train toasts, number format, save export/import,
 * «Сохранить сейчас», a doubly-confirmed hard reset, and a short «Об игре».
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { sfx } from "@/audio/sfx";
import { useGame } from "@/game/store";
import type { Settings } from "@/game/types";
import { BrassButton, cx } from "@/components/ui/kit";
import { SectionTitle, Switch } from "./common";

export default function SettingsTab() {
  return (
    <div className="pb-2">
      <h2 className="font-display text-lg font-bold tracking-wide text-brass-light">
        <span className="mr-1.5">⚙</span>Настройки
      </h2>
      <p className="text-xs italic text-parchment-dim">Контора колонии. Здесь крутят ручки, а не хвосты.</p>
      <SoundSection />
      <ViewSection />
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

function SoundSection() {
  const [sound, setSound] = useSetting("sound");
  const [volume, setVolume] = useSetting("volume");
  const [drag, setDrag] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const timer = useRef(0);
  const shown = drag ?? volume;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // commit at most ~8 times a second while dragging (each commit clones the game state)
  const schedule = (v: number) => {
    pending.current = v;
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      if (pending.current !== null) setVolume(pending.current);
    }, 120);
  };
  const finish = () => {
    if (drag === null) return;
    window.clearTimeout(timer.current);
    timer.current = 0;
    setVolume(drag);
    setDrag(null);
    if (sound) sfx.tin();
  };

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
        <div className={cx("px-1", !sound && "opacity-50")}>
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="rr-volume" className="font-bold text-parchment">
              Громкость
            </label>
            <span className="font-mono tabular text-brass-light">{Math.round(shown * 100)}%</span>
          </div>
          <input
            id="rr-volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(shown * 100)}
            disabled={!sound}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setDrag(v);
              sfx.setVolume(v, sound);
              schedule(v);
            }}
            onPointerUp={finish}
            onKeyUp={finish}
            onBlur={finish}
            className="rr-range block w-full disabled:cursor-not-allowed"
            style={{ "--pct": `${Math.round(shown * 100)}%`, accentColor: "var(--brass)" } as CSSProperties}
          />
        </div>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ view */

function ViewSection() {
  const [reduced, setReduced] = useSetting("reducedMotion");
  const [noShake, setNoShake] = useSetting("noShake");
  const [toasts, setToasts] = useSetting("trainToasts");
  const [sci, setSci] = useSetting("sciNotation");
  return (
    <>
      <SectionTitle>Экран</SectionTitle>
      <Card className="grid gap-0.5">
        <Switch on={reduced} onToggle={() => setReduced(!reduced)} label="Меньше движения" sub="Без тряски, зума и вспышек; частиц на 70% меньше" />
        <Switch
          on={noShake || reduced}
          disabled={reduced}
          onToggle={() => setNoShake(!noShake)}
          label="Без тряски"
          sub={reduced ? "Уже включено вместе с «Меньше движения»" : "Экран не дрожит от поездов и раскопок"}
        />
        <Switch on={toasts} onToggle={() => setToasts(!toasts)} label="Тосты «К путям!»" sub="Колокольчик и напоминание за 30 с до поезда" />
        <Switch
          on={sci}
          onToggle={() => setSci(!sci)}
          label="Научный формат чисел"
          sub={sci ? "Сейчас: 1.23e45 — для учёных крыс" : "Сейчас: 1.23K, 4.5M, 6.7Qa — для простых крыс"}
        />
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
    useGame.getState().save();
    setSaveNote({ ok: true, text: `Сохранено в ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. Летопись в безопасности.` });
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
            Автосохранение каждые 15 с.
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
              className="block w-full resize-none break-all rounded-md border border-line bg-soot/80 p-2 font-mono text-[10.5px] leading-snug text-parchment-dim outline-none focus:border-brass-dark"
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
            className="block w-full resize-none break-all rounded-md border border-line bg-soot/80 p-2 font-mono text-[10.5px] leading-snug text-parchment outline-none placeholder:text-muted focus:border-brass-dark"
          />
          <div className="flex flex-wrap items-center gap-2">
            <BrassButton tone="copper" onClick={doImport} disabled={!importText.trim()} className="min-h-10">
              Загрузить
            </BrassButton>
            <span className="text-[11px] leading-tight text-parchment-dim">Текущая колония будет заменена.</span>
          </div>
          <NoteLine note={importNote} />
        </div>
      </Card>
    </>
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
              className="block h-10 w-full rounded-md border border-danger/50 bg-soot/80 px-2 font-mono text-sm uppercase tracking-widest text-parchment outline-none placeholder:text-muted focus:border-danger-light"
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
        <p className="text-xs italic text-parchment-dim">«Для людей это один вторник. Для крыс — целая история».</p>
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
