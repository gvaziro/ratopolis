/**
 * When the coronation show may open (v3 SHL-2, K1), kept apart from the overlay so vitest can drive it with the real
 * store and fx bus: the show waits while an offline report is open or a close-up scene runs (the haul card included),
 * and opens on the first store sample that clears the last of them. Repeat coronations (the third and later) open
 * straight on the finale card.
 */
import { sfx } from "@/audio/sfx";
import { onFx } from "@/game/fx";
import { useGame, type GameStore } from "@/game/store";

/** From this coronation on (meta.coronations, counted before the fx) the show opens on the finale card. */
export const REPEAT_CORONATION_FROM = 3;
/** Bell strikes of the whole ride and of the short form (the finale card at once). */
export const BELLS = 12;
export const SHORT_BELLS = 3;

/** The show must wait: an offline report is open or a scene is up (any phase, the haul card included). */
export function coronationWaits(st: Pick<GameStore, "offlineReport"> & { game: Pick<GameStore["game"], "scene"> }): boolean {
  return !!st.offlineReport || !!st.game.scene;
}

/** The short form (finale card, three bells): a third or later coronation, or `?coronation=repeat` in dev. */
export function shortCoronation(coronations: number, search = ""): boolean {
  return coronations >= REPEAT_CORONATION_FROM || /[?&]coronation=repeat\b/.test(search);
}

/** The bells a coronation rings: three in the short form, twelve for the whole ride. */
export function bellsOf(coronations: number, search = ""): number {
  return shortCoronation(coronations, search) ? SHORT_BELLS : BELLS;
}

/**
 * Ring `count` bells with the anthem after the last one; `restart` cuts a sequence still sounding and its anthem
 * («Полная церемония ›»), which the limiter would otherwise drop. A second call without it while the bells still
 * ring (the late path: the AudioDirector rings as the ceremony opens too) leaves the first sequence as it is.
 */
export function ringBells(count: number, restart = false): void {
  sfx.coronationBells(count, restart);
}

/**
 * Watch for a coronation: `open(late)` runs once per coronation — at once on the fx when nothing holds it
 * (`late` false: the AudioDirector already rang the bells), or on the store sample that clears the report and the
 * scene (`late` true: the bells rang unheard, ring them again). Returns the unsubscribe.
 */
export function watchCoronation(open: (late: boolean) => void): () => void {
  let pending = !!useGame.getState().offlineReport?.coronated;
  const offStore = useGame.subscribe((st, prev) => {
    if (st.offlineReport !== prev.offlineReport && st.offlineReport?.coronated) pending = true;
    if (!pending || coronationWaits(st)) return;
    pending = false;
    open(true);
  });
  const offFx = onFx((fx) => {
    if (fx.k !== "coronation") return;
    if (coronationWaits(useGame.getState())) {
      pending = true;
      return;
    }
    pending = false;
    open(false);
  });
  return () => {
    offStore();
    offFx();
  };
}
