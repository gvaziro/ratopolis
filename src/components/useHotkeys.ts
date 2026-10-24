"use client";

/**
 * Global hotkeys (SH-4), mounted once in GameRoot:
 * 1–8 open the revealed tabs in order, B cycles the buy mode ×1 → ×10 → Макс, G (or Enter with nothing focused)
 * clicks the grate, M toggles the sound, Esc sends the window event "rr-escape" (goal popover, tips, news log and the
 * market close on it). Keys are ignored while typing, while a modal dialog is open and while a scene runs (scenes
 * handle their own keys); Esc always goes out.
 */
import { useEffect } from "react";
import { sfx } from "@/audio/sfx";
import { TAB_ORDER, tabRevealed } from "@/components/panels/alerts";
import { useGame } from "@/game/store";
import type { BuyMode } from "@/game/types";

/** The window event Esc dispatches: popovers and the market close on it. */
export const ESCAPE_EVENT = "rr-escape";

const BUY_CYCLE: BuyMode[] = [1, 10, "max"];

/** Inputs that take no text: a focused slider or checkbox (⚙ volume, the Jobs ratios) must not swallow the hotkeys. */
const NON_TEXT_INPUTS = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"]);

function typing(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  return tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function modalOpen(): boolean {
  return !!document.querySelector('[role="dialog"][aria-modal="true"]');
}

export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        window.dispatchEvent(new Event(ESCAPE_EVENT));
        return;
      }
      if (typing(document.activeElement) || modalOpen()) return;
      const st = useGame.getState();
      if (st.game.scene || st.crashed || st.saveIssue) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (/^[1-8]$/.test(k)) {
        const tabs = TAB_ORDER.filter((t) => tabRevealed(st.game, t));
        const t = tabs[Number(k) - 1];
        if (t) {
          st.setTab(t);
          e.preventDefault();
        }
      } else if (k === "b" || k === "и") {
        const i = BUY_CYCLE.indexOf(st.buyMode);
        st.setBuyMode(BUY_CYCLE[(i + 1) % BUY_CYCLE.length]);
        e.preventDefault();
      } else if (k === "g" || k === "п" || (k === "Enter" && (document.activeElement === document.body || !document.activeElement))) {
        if (e.repeat) return;
        // the grate handles Enter itself (squash, dust); the engine caps clicks at 15/s
        const grate = document.querySelector('[aria-label^="Решётка водостока"]');
        if (grate) grate.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        else st.click();
        e.preventDefault();
      } else if (k === "m" || k === "ь") {
        const s = st.game.settings;
        sfx.unlock();
        sfx.setVolume(s.volume, !s.sound);
        st.setSetting("sound", !s.sound);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
