"use client";

/**
 * Save-safety dialogs driven by `store.saveIssue` (EN-8). While one is open the game neither ticks nor saves.
 * - corrupt: «Летопись повреждена» — restore a rolling backup, download the quarantined copy, or start afresh
 * - newer:   the save comes from a newer version of the game — only a reload helps (the save is never touched)
 * - locked:  the colony is open in another tab — «Играть здесь» takes play over
 */
import { useId, useState } from "react";
import { useGame, type BackupInfo, type SaveIssue } from "@/game/store";
import { BrassButton } from "@/components/ui/kit";
import { clockAt, downloadText, ratsLabel, SootFrame } from "@/components/ui/crashKit";
import HudStyles from "@/components/layout/HudStyles";

export default function SaveIssueModal() {
  const issue = useGame((s) => s.saveIssue);
  if (!issue) return null;
  // keyed per kind: local confirm/waiting state never leaks from one dialog into the next
  return <IssueDialog key={issue.kind} issue={issue} />;
}

function IssueDialog({ issue }: { issue: NonNullable<SaveIssue> }) {
  const titleId = useId();
  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-[3px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ animation: "hud-fade-in .25s ease-out both" }}
    >
      <HudStyles />
      <SootFrame className="my-auto max-w-[480px]" labelledBy={titleId}>
        {issue.kind === "corrupt" ? (
          <Corrupt titleId={titleId} quarantineKey={issue.quarantineKey} />
        ) : issue.kind === "newer" ? (
          <Newer titleId={titleId} version={issue.version} />
        ) : (
          <Locked titleId={titleId} />
        )}
      </SootFrame>
    </div>
  );
}

function Head({ titleId, icon, kicker, title }: { titleId: string; icon: string; kicker: string; title: string }) {
  return (
    <header className="text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-brass bg-gradient-to-b from-[#3a2c18] to-soot text-[28px] shadow-[0_0_0_1px_#2a1f14,0_0_18px_rgba(242,184,75,.25)]" aria-hidden>
        {icon}
      </div>
      <p className="mt-2 font-display text-[11px] font-bold uppercase tracking-[0.3em] text-brass">{kicker}</p>
      <h2 id={titleId} className="mt-0.5 font-display text-[24px] font-bold leading-tight text-brass-light sm:text-[27px]">
        {title}
      </h2>
    </header>
  );
}

/* ------------------------------------------------------------ corrupt */

function Corrupt({ titleId, quarantineKey }: { titleId: string; quarantineKey: string }) {
  const [backups] = useState<BackupInfo[]>(() => useGame.getState().backups());
  const [confirmFresh, setConfirmFresh] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const restore = (b: BackupInfo) => {
    if (!useGame.getState().restoreBackup(b.slot)) setNote("И эта копия не читается. Попробуйте другую.");
  };
  const downloadBroken = () => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(quarantineKey);
    } catch {
      raw = null;
    }
    if (raw === null) setNote("Повреждённый свиток не найден в хранилище браузера.");
    else setNote(downloadText("ratropolis-save-damaged.txt", raw) ? "Повреждённый свиток отправлен в «Загрузки»." : "Браузер не дал скачать файл.");
  };

  return (
    <>
      <Head titleId={titleId} icon="📜" kicker="Срочно в архив" title="Летопись повреждена" />
      <p className="mt-1.5 text-center text-[13px] leading-snug text-parchment">
        Сохранение не читается — похоже, его кто-то погрыз. Свиток мы отложили в сторонку и ничего не стёрли: выберите, с чего продолжить.
      </p>
      <div className="mt-4 grid gap-2">
        {backups.map((b, i) => (
          <BrassButton key={b.slot} autoFocus={i === 0} tone={i === 0 ? "brass" : "verdigris"} onClick={() => restore(b)} className="min-h-11">
            🕰 Восстановить копию от {clockAt(b.at)}
            <span className="ml-1 whitespace-nowrap font-normal opacity-80">({ratsLabel(b.rats)})</span>
          </BrassButton>
        ))}
        {backups.length === 0 && (
          <p className="rounded-md border border-line/70 bg-soot/50 px-2.5 py-2 text-center text-xs italic leading-snug text-parchment-dim">
            Запасных копий пока нет: они появляются каждые 5 минут игры.
          </p>
        )}
        <BrassButton tone="ghost" onClick={downloadBroken} className="min-h-11">
          📥 Скачать повреждённую
        </BrassButton>
        {!confirmFresh ? (
          <BrassButton autoFocus={backups.length === 0} tone="danger" onClick={() => setConfirmFresh(true)} className="min-h-11">
            🔥 Начать заново…
          </BrassButton>
        ) : (
          <div className="rounded-md border border-danger/60 bg-danger/10 p-2.5" role="group" aria-label="Подтверждение">
            <p className="text-[13px] leading-snug text-parchment">
              <b className="text-danger-light">Новая колония</b> начнётся с одинокого вожака у решётки. Повреждённый свиток останется в хранилище — его
              ещё можно скачать.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <BrassButton tone="danger" onClick={() => useGame.getState().startFresh()} className="min-h-11">
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
    </>
  );
}

/* ------------------------------------------------------------ newer */

function Newer({ titleId, version }: { titleId: string; version: number }) {
  return (
    <>
      <Head titleId={titleId} icon="🕰" kicker="Расписание обновилось" title="Сохранение из более новой версии — обновите страницу" />
      <p className="mt-1.5 text-center text-[13px] leading-snug text-parchment">
        Летопись написана более свежей версией колонии (схема v{version}), а эта вкладка отстала от поезда. Мы её не трогаем и ничего не
        записываем — просто обновите страницу.
      </p>
      <div className="mt-4 grid">
        <BrassButton autoFocus size="lg" onClick={() => window.location.reload()} className="min-h-11">
          ↻ Обновить страницу
        </BrassButton>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ locked */

function Locked({ titleId }: { titleId: string }) {
  const [waiting, setWaiting] = useState(false);
  return (
    <>
      <Head titleId={titleId} icon="🗝" kicker="Запасной путь" title="Колония уже открыта в другой вкладке" />
      <p className="mt-1.5 text-center text-[13px] leading-snug text-parchment">
        Два вожака на одну колонию — верный путь к бунту, а летопись у нас одна. Здесь всё стоит на паузе, пока игра идёт там.
      </p>
      <div className="mt-4 grid">
        <BrassButton
          autoFocus
          size="lg"
          disabled={waiting}
          onClick={() => {
            setWaiting(true);
            useGame.getState().takeOverTab();
          }}
          className="min-h-11"
        >
          {waiting ? "Принимаем ключи от колонии…" : "🐀 Играть здесь"}
        </BrassButton>
      </div>
      <p className="mt-2 text-center text-[11px] leading-snug text-parchment-dim">Та вкладка сохранится и уступит место — без потерь.</p>
    </>
  );
}
