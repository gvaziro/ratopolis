"use client";

/**
 * «Крысы перегрызли провод»: the themed crash screen instead of a dead page.
 * `CrashGuard` is an error boundary around the game layout (GameRoot keeps the loop outside it). It shows the screen
 * when a render throws, and when the store says the engine crashed (`store.crashed`). A caught render error also
 * marks the store crashed, so nothing ticks or saves until the player picks a way out: the stored save stays the
 * pre-crash one and «Скачать сохранение» hands it over as is.
 */
import { Component, useId, useState, type ErrorInfo, type ReactNode } from "react";
import { useGame, type BackupInfo } from "@/game/store";
import { BrassButton } from "@/components/ui/kit";
import { clockAt, downloadText, GnawedWire, ratsLabel, SootFrame } from "@/components/ui/crashKit";

export default function CrashGuard({ children }: { children: ReactNode }) {
  const crashed = useGame((s) => s.crashed);
  const crashError = useGame((s) => s.crashError);
  return (
    <Boundary crashed={crashed} crashError={crashError}>
      {children}
    </Boundary>
  );
}

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

interface BoundaryProps {
  crashed: boolean;
  crashError: string | null;
  children: ReactNode;
}

class Boundary extends Component<BoundaryProps, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error("unknown") };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[ratropolis] render error", error, info.componentStack);
    // freeze the loop and the autosave: the save on disk is the last good one
    useGame.getState().markCrashed(errorText(error));
  }

  private recovered = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error !== null || this.props.crashed) {
      return <CrashPanel detail={error !== null ? errorText(error) : this.props.crashError} onRecovered={this.recovered} />;
    }
    return this.props.children;
  }
}

/* ------------------------------------------------------------ the screen */

function CrashPanel({ detail, onRecovered }: { detail: string | null; onRecovered: () => void }) {
  const calm = useGame((s) => s.game.settings.reducedMotion);
  const titleId = useId();
  const [backups] = useState<BackupInfo[]>(() => useGame.getState().backups());
  const [hasSave] = useState(() => useGame.getState().rawSave() !== null);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // store first (a good state is in place), then the boundary lets the layout render again
  const restart = () => {
    useGame.getState().resetCrash();
    onRecovered();
  };
  const restore = (b: BackupInfo) => {
    if (useGame.getState().restoreBackup(b.slot)) onRecovered();
    else setNote("Эта копия тоже не читается. Попробуйте другую или скачайте сохранение.");
  };
  const fresh = () => {
    useGame.getState().startFresh();
    onRecovered();
  };
  const download = () => {
    const raw = useGame.getState().rawSave();
    if (!raw) {
      setNote("Сундук пуст: сохранения ещё нет.");
      return;
    }
    setNote(downloadText("ratropolis-save.txt", raw) ? "Свиток с сохранением отправлен в «Загрузки»." : "Браузер не дал скачать файл.");
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-soot pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        background:
          "radial-gradient(ellipse at 50% 30%, rgba(242,184,75,.08), transparent 60%), repeating-linear-gradient(135deg, rgba(0,0,0,.18) 0 2px, transparent 2px 9px), var(--soot)",
      }}
    >
      <SootFrame className="my-auto max-w-[520px]" labelledBy={titleId}>
        <GnawedWire calm={calm} className="block h-auto w-full rounded-md border border-brass-dark/60" />
        <p className="mt-3 text-center font-display text-[11px] font-bold uppercase tracking-[0.3em] text-brass">Машинное отделение колонии</p>
        <h1 id={titleId} className="mt-0.5 text-center font-display text-[26px] font-bold leading-tight text-brass-light sm:text-[30px]">
          Крысы перегрызли провод
        </h1>
        <p className="mt-1.5 text-center text-[13px] leading-snug text-parchment">
          Машина колонии заискрила и встала. Без паники: летописец успел спрятать последнее сохранение в жестяную коробку, и с тех пор
          ничего не записывалось.
        </p>

        <div className="mt-4 grid gap-2">
          <BrassButton autoFocus size="lg" onClick={restart} className="min-h-11">
            🔧 Перезапустить
          </BrassButton>
          <BrassButton tone="ghost" onClick={download} disabled={!hasSave} className="min-h-11" title={hasSave ? undefined : "Сохранения ещё нет"}>
            📜 Скачать сохранение
          </BrassButton>
          {backups.map((b) => (
            <BrassButton key={b.slot} tone="verdigris" onClick={() => restore(b)} className="min-h-11">
              🕰 Восстановить копию от {clockAt(b.at)}
              <span className="ml-1 whitespace-nowrap font-normal opacity-80">({ratsLabel(b.rats)})</span>
            </BrassButton>
          ))}
          {!confirmFresh ? (
            <BrassButton tone="danger" onClick={() => setConfirmFresh(true)} className="min-h-11">
              🔥 Начать заново…
            </BrassButton>
          ) : (
            <div className="rounded-md border border-danger/60 bg-danger/10 p-2.5" role="group" aria-label="Подтверждение">
              <p className="text-[13px] leading-snug text-parchment">
                <b className="text-danger-light">Точно?</b> Вожак снова окажется один у решётки. Настройки останутся, а нынешняя колония уйдёт в
                запасную копию.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <BrassButton tone="danger" onClick={fresh} className="min-h-11">
                  Да, начать заново
                </BrassButton>
                <BrassButton tone="ghost" onClick={() => setConfirmFresh(false)} className="min-h-11">
                  Передумал
                </BrassButton>
              </div>
            </div>
          )}
        </div>

        {note && (
          <p role="status" className="mt-2 text-center text-xs leading-snug text-gaslight">
            {note}
          </p>
        )}

        {detail && (
          <details className="mt-3 rounded-md border border-line/70 bg-soot/60 px-2.5 py-1.5 text-[11px] text-parchment-dim">
            <summary className="cursor-pointer select-none font-bold text-parchment-dim hover:text-parchment">Записка механика</summary>
            <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[10.5px] leading-snug">{detail}</code>
          </details>
        )}
      </SootFrame>
    </div>
  );
}
