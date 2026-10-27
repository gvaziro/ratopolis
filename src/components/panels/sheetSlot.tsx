"use client";

/**
 * The phone sheet's handle row has a slot on its left (PAN-3): the open tab may portal one compact control there
 * (Постройки: ×1 / ×10 / Макс), so its sticky toolbar takes no room in the half sheet. SidePanel provides the slot
 * element only below md, where the handle shows; elsewhere it is null and the tab keeps the control in its toolbar.
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { matchesQuery } from "@/lib/layoutMode";

export const SheetSlotContext = createContext<HTMLElement | null>(null);

/** Below md: the bottom-sheet layout (Tailwind's max-md), where the handle row and the dense cards live. */
const NARROW_MQ = "(max-width: 767.98px)";

function subscribeNarrow(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const m = window.matchMedia(NARROW_MQ);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

/** True below md (the phone sheet); false on the server and on wider screens, landscape phones included. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => matchesQuery(NARROW_MQ), () => false);
}

/** The handle row's slot element on phones, or null (desktop, landscape column, not mounted yet). */
export function useSheetSlot(): HTMLElement | null {
  return useContext(SheetSlotContext);
}

/** Renders its children into the handle row's slot (nothing when there is no slot). */
export function SheetSlot({ children }: { children: ReactNode }) {
  const el = useSheetSlot();
  return el ? createPortal(children, el) : null;
}
