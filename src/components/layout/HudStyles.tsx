"use client";

/**
 * Keyframes and helper classes for the HUD shell (header, «Наверху», resource bar, ticker, toasts,
 * offline report). Every HUD component renders <HudStyles/>; React 19 hoists and de-duplicates it by href.
 * `.hud-calm` on an ancestor (reduced motion) turns decorative loops off: every endless loop of the resource bar and
 * of «Наверху» (walkers' legs, smoke, rain, the mini-scenes stand still in their resting pose). Walkers waiting off
 * the street (visibility hidden) keep their legs paused in any mode.
 */
const CSS = `
@keyframes hud-pop{0%{transform:scale(.3);opacity:0}60%{transform:scale(1.12);opacity:1}100%{transform:scale(1)}}
@keyframes hud-blink2{0%,70%,100%{opacity:1}80%{opacity:.25}90%{opacity:1}}
@keyframes hud-over{0%,100%{box-shadow:0 0 0 1px rgba(242,184,75,.55),0 0 6px 1px rgba(242,184,75,.35),inset 0 0 6px rgba(242,184,75,.25)}50%{box-shadow:0 0 0 1px rgba(255,214,120,.95),0 0 16px 4px rgba(242,184,75,.6),inset 0 0 12px rgba(242,184,75,.45)}}
@keyframes hud-twinkle{0%,100%{transform:scale(.2) rotate(0);opacity:0}45%{transform:scale(1) rotate(90deg);opacity:1}70%{opacity:.9}}
@keyframes hud-alarm{0%,100%{box-shadow:0 0 0 0 rgba(196,69,58,0)}50%{box-shadow:0 0 10px 2px rgba(232,112,95,.75)}}
@keyframes hud-throb{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes hud-shiver{0%,100%{transform:translateX(0)}25%{transform:translateX(-1px)}75%{transform:translateX(1px)}}
@keyframes hud-in-r{0%{transform:translateX(115%);opacity:0}65%{transform:translateX(-6%);opacity:1}100%{transform:translateX(0)}}
@keyframes hud-in-t{0%{transform:translateY(-130%);opacity:0}65%{transform:translateY(6%);opacity:1}100%{transform:translateY(0)}}
@keyframes hud-out-r{to{transform:translateX(115%);opacity:0}}
@keyframes hud-out-t{to{transform:translateY(-130%);opacity:0}}
@keyframes hud-fade-in{from{opacity:0}to{opacity:1}}
@keyframes hud-fade-out{to{opacity:0}}
@keyframes hud-drop{0%{transform:translate(-50%,-140%) scale(.9);opacity:0}55%{transform:translate(-50%,8%) scale(1.03);opacity:1}75%{transform:translate(-50%,-3%) scale(1)}100%{transform:translate(-50%,0)}}
@keyframes hud-spin-in{0%{transform:translate(-50%,0) rotate(-720deg) scale(.05);opacity:0}70%{transform:translate(-50%,0) rotate(6deg) scale(1.06);opacity:1}100%{transform:translate(-50%,0) rotate(-1.5deg) scale(1)}}
@keyframes hud-slam{0%{transform:translate(-50%,0) scale(2.4);opacity:0}45%{transform:translate(-50%,0) scale(.92);opacity:1}65%{transform:translate(-50%,0) scale(1.06)}100%{transform:translate(-50%,0) scale(1)}}
@keyframes hud-banner-out{to{transform:translate(-50%,-30%);opacity:0}}
@keyframes hud-shine{0%{background-position:-180% 0}100%{background-position:280% 0}}
@keyframes hud-flash{0%{background:rgba(242,184,75,.75)}100%{background:rgba(242,184,75,0)}}
@keyframes hud-slide-l{0%{transform:translateX(60%);opacity:0}100%{transform:translateX(0);opacity:1}}
@keyframes hud-rays{to{transform:rotate(360deg)}}
@keyframes hud-countup{0%{transform:translateY(40%);opacity:0}100%{transform:translateY(0);opacity:1}}
@keyframes hud-fuse{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.hud-pop{animation:hud-pop .45s cubic-bezier(.2,1.4,.4,1) both}
.hud-blink2{animation:hud-blink2 2s ease-in-out infinite}
.hud-over{animation:hud-over 1.6s ease-in-out infinite}
.hud-twinkle{animation:hud-twinkle 1.4s ease-in-out infinite}
.hud-alarm{animation:hud-alarm 1s ease-in-out infinite}
.hud-throb{animation:hud-throb 1s ease-in-out infinite}
.hud-shiver{animation:hud-shiver .18s linear infinite}
.hud-shine{background-size:220% 100%;animation:hud-shine 3.2s linear infinite}
.hud-flash{animation:hud-flash 1.2s ease-out both}
.hud-slide-l{animation:hud-slide-l .5s cubic-bezier(.2,1.2,.4,1) both}
.hud-rays{animation:hud-rays 14s linear infinite}
.hud-countup{animation:hud-countup .5s ease-out both}
.hud-toast-in{animation:hud-in-t .5s cubic-bezier(.2,1.2,.4,1) both}
.hud-toast-out{animation:hud-out-t .25s ease-in both}
@media (min-width:768px){
  .hud-toast-in{animation-name:hud-in-r}
  .hud-toast-out{animation-name:hud-out-r}
}
.hud-calm .hud-toast-in,.hud-toast-in.hud-calm{animation:hud-fade-in .3s ease-out both}
.hud-calm .hud-toast-out,.hud-toast-out.hud-calm{animation:hud-fade-out .25s ease-in both}
.hud-banner-drop{animation:hud-drop .65s cubic-bezier(.2,1.2,.4,1) both}
.hud-banner-spin{animation:hud-spin-in .8s cubic-bezier(.2,1,.4,1) both}
.hud-banner-slam{animation:hud-slam .45s cubic-bezier(.2,1.2,.4,1) both}
.hud-banner-out{animation:hud-banner-out .35s ease-in both}
.hud-calm .hud-banner-drop,.hud-calm .hud-banner-spin,.hud-calm .hud-banner-slam{animation:hud-fade-in .3s ease-out both;transform:translate(-50%,0)}
.hud-calm .hud-banner-out{animation:hud-fade-out .3s ease-in both}
.hud-calm .hud-blink2,.hud-calm .hud-twinkle,.hud-calm .hud-throb,.hud-calm .hud-shiver,.hud-calm .hud-shine,.hud-calm .hud-rays,.hud-calm .hud-pop,.hud-calm .hud-slide-l{animation:none}
.hud-calm .hud-over{animation:none;box-shadow:0 0 0 1px rgba(242,184,75,.8),0 0 8px 2px rgba(242,184,75,.45)}
.hud-calm .hud-alarm{animation:none;box-shadow:0 0 6px 1px rgba(232,112,95,.6)}
.hud-noscroll{scrollbar-width:none;-ms-overflow-style:none}
.hud-noscroll::-webkit-scrollbar{display:none}
.hud-brass-text{background:linear-gradient(180deg,#fff1c9 0%,var(--brass-light) 38%,var(--brass) 62%,var(--brass-dark) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 1px 0 rgba(0,0,0,.6))}
.hud-paper{background:radial-gradient(ellipse at 30% 20%,rgba(255,255,255,.35),transparent 60%),radial-gradient(ellipse at 80% 90%,rgba(120,90,50,.18),transparent 55%),repeating-linear-gradient(0deg,rgba(90,70,40,.035) 0 1px,transparent 1px 3px),#e9dcc0;color:#2a1f14}
.hud-rule{border-top:3px double #2a1f14}

/* «Наверху» */
@keyframes sk-leg{from{transform:rotate(-24deg)}to{transform:rotate(24deg)}}
@keyframes sk-spin{to{transform:rotate(360deg)}}
@keyframes sk-smoke{0%{transform:translate(0,0) scale(.4);opacity:0}15%{opacity:.55}100%{transform:translate(var(--dx,-14px),-26px) scale(1.9);opacity:0}}
@keyframes sk-bigsmoke{0%{transform:translate(0,0) scale(.5);opacity:0}12%{opacity:.75}100%{transform:translate(var(--dx,-30px),-46px) scale(2.6);opacity:0}}
@keyframes sk-rain{from{transform:translate(0,-24px)}to{transform:translate(-6px,0)}}
@keyframes sk-flicker{0%{opacity:.82}40%{opacity:1}70%{opacity:.9}100%{opacity:.97}}
@keyframes sk-tail{from{transform:rotate(-18deg)}to{transform:rotate(22deg)}}
@keyframes sk-eyes{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes sk-note{0%{transform:translate(0,0);opacity:0}15%{opacity:1}100%{transform:translate(var(--dx,10px),-30px);opacity:0}}
@keyframes sk-bob{from{transform:translateY(0)}to{transform:translateY(-1px)}}
@keyframes sk-capsule{0%{transform:translateY(-6px);opacity:0}10%{opacity:1}70%{transform:translateY(30px);opacity:1}80%,100%{transform:translateY(30px);opacity:0}}
@keyframes sk-puff{0%,60%{transform:scale(.2);opacity:0}70%{opacity:.85}100%{transform:scale(1.8);opacity:0}}
@keyframes sk-glow{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes sk-ripple{0%{transform:scale(.2);opacity:.9}100%{transform:scale(1.6);opacity:0}}
@keyframes sk-shake{0%,100%{transform:translate(0,0)}25%{transform:translate(.6px,-.4px)}75%{transform:translate(-.6px,.4px)}}
@keyframes sk-board{0%,100%{opacity:1}50%{opacity:.35}}
.sk-fb{transform-box:fill-box;transform-origin:center}
.sk-leg{transform-box:fill-box;transform-origin:50% 0;animation:sk-leg .32s ease-in-out infinite alternate}
.sk-leg2{animation-delay:-.32s}
.sk-spin{transform-box:fill-box;transform-origin:center;animation:sk-spin .5s linear infinite}
.sk-smoke{transform-box:fill-box;transform-origin:center;animation:sk-smoke 5s ease-out infinite}
.sk-bigsmoke{transform-box:fill-box;transform-origin:center;animation:sk-bigsmoke 6s ease-out infinite}
.sk-rain{animation:sk-rain .45s linear infinite}
.sk-flicker{animation:sk-flicker 1.7s ease-in-out infinite alternate}
.sk-tail{transform-box:fill-box;transform-origin:0 100%;animation:sk-tail 1.4s ease-in-out infinite alternate}
.sk-eyes{transform-box:fill-box;transform-origin:center;animation:sk-eyes 3.2s ease-in-out infinite}
.sk-note{transform-box:fill-box;transform-origin:center;animation:sk-note 2.4s ease-out infinite}
.sk-bob{animation:sk-bob .6s ease-in-out infinite alternate}
.sk-capsule{animation:sk-capsule 1.5s cubic-bezier(.5,0,.9,.5) infinite}
.sk-puff{transform-box:fill-box;transform-origin:center;animation:sk-puff 1.5s ease-out infinite}
.sk-glow{animation:sk-glow 1.2s ease-in-out infinite}
.sk-ripple{transform-box:fill-box;transform-origin:center;animation:sk-ripple 1.3s ease-out infinite}
.sk-shake{animation:sk-shake .12s linear infinite}
.sk-board-blink{animation:sk-board 1s steps(2,jump-none) infinite}
.hud-calm :is(.sk-leg,.sk-bob,.sk-spin,.sk-smoke,.sk-bigsmoke,.sk-rain,.sk-flicker,.sk-tail,.sk-eyes,.sk-note,.sk-capsule,.sk-puff,.sk-glow,.sk-ripple,.sk-shake,.sk-board-blink){animation:none}
g[visibility="hidden"] :is(.sk-leg,.sk-bob){animation-play-state:paused}
`;

export default function HudStyles() {
  return (
    <style href="rr-hud-styles" precedence="medium">
      {CSS}
    </style>
  );
}
