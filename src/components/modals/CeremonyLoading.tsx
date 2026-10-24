"use client";

/**
 * What a lazily loaded overlay (SH-5) shows while its chunk arrives: the overlay's own dark backdrop, already a modal
 * dialog, so the screen dims at once and the toasts, banners and hotkeys hold from the first frame.
 */
export default function CeremonyLoading({ label, z = "z-[60]", tint = "bg-soot/95" }: { label: string; z?: string; tint?: string }) {
  return <div className={`fixed inset-0 ${z} ${tint}`} role="dialog" aria-modal="true" aria-label={label} aria-busy="true" />;
}
