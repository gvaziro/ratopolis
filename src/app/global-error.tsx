"use client";

/**
 * Last line of defence (Next 16 `global-error`): replaces the root layout when even the game shell failed to load,
 * e.g. a stale chunk after an update. It renders its own <html>/<body> and imports the global styles itself.
 * Deliberately free of game imports: it reads the save straight from localStorage so the player can take it home.
 */
import { useEffect, useState } from "react";
import { BRASS_BTN, GHOST_BTN, GnawedWire, SootFrame, downloadText } from "@/components/ui/crashKit";
import "./globals.css";

/** Mirrors SAVE_KEY in src/game/engine/save.ts (plus the dev-only `?slot=` suffix of store.ts saveKey()). */
const SAVE_KEY = "ratropolis.save.v1";

function saveKey(): string {
  if (process.env.NODE_ENV === "production") return SAVE_KEY;
  try {
    const slot = new URLSearchParams(window.location.search).get("slot");
    return slot ? `${SAVE_KEY}:${slot}` : SAVE_KEY;
  } catch {
    return SAVE_KEY;
  }
}

function readSave(): string | null {
  try {
    return localStorage.getItem(saveKey());
  } catch {
    return null;
  }
}

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    console.error("[ratropolis] global error", error);
  }, [error]);

  const download = () => {
    const raw = readSave();
    if (!raw) setNote("Сундук пуст: сохранения в этом браузере нет.");
    else setNote(downloadText("ratropolis-save.txt", raw) ? "Свиток с сохранением отправлен в «Загрузки»." : "Браузер не дал скачать файл.");
  };
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return (
    <html lang="ru">
      <head>
        <title>Ratropolis Underground — провод перегрызен</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="min-h-dvh bg-soot text-parchment" style={{ fontFamily: "'PT Sans', system-ui, sans-serif" }}>
        <main className="flex min-h-dvh items-start justify-center p-4 sm:items-center">
          <SootFrame className="my-auto max-w-[520px]" labelledBy="rr-global-error-title">
            <GnawedWire className="block h-auto w-full rounded-md border border-brass-dark/60" />
            <p className="mt-3 text-center text-[11px] font-bold uppercase tracking-[0.3em] text-brass" style={{ fontFamily: "Georgia, serif" }}>
              Машинное отделение колонии
            </p>
            <h1
              id="rr-global-error-title"
              className="mt-0.5 text-center text-[26px] font-bold leading-tight text-brass-light sm:text-[30px]"
              style={{ fontFamily: "'Cormorant SC', Georgia, 'Times New Roman', serif" }}
            >
              Крысы перегрызли провод
            </h1>
            <p className="mt-1.5 text-center text-[13px] leading-snug">
              Колония не смогла даже открыть ворота. Чаще всего помогает перезагрузка: возможно, наверху вышла новая версия, а у вас в кармане старое
              расписание. Сохранение лежит в браузере в целости — его можно забрать с собой.
            </p>
            <div className="mt-4 grid gap-2">
              <button type="button" className={BRASS_BTN} onClick={() => window.location.reload()} autoFocus>
                ↻ Перезагрузить страницу
              </button>
              <button type="button" className={GHOST_BTN} onClick={() => retry()}>
                🔧 Попробовать ещё раз
              </button>
              <button type="button" className={GHOST_BTN} onClick={download}>
                📜 Скачать сохранение
              </button>
            </div>
            {note && (
              <p role="status" className="mt-2 text-center text-xs leading-snug text-gaslight">
                {note}
              </p>
            )}
            <details className="mt-3 rounded-md border border-line/70 bg-soot/60 px-2.5 py-1.5 text-[11px] text-parchment-dim">
              <summary className="cursor-pointer select-none font-bold">Записка механика</summary>
              <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[10.5px] leading-snug">{detail}</code>
            </details>
          </SootFrame>
        </main>
      </body>
    </html>
  );
}
