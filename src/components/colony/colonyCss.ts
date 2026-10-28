/**
 * Infinite decorative loops: paused with settings.reducedMotion (.cv-rm) and with the OS «reduce motion»
 * unless the player switched motion back on by hand (.cv-motion). Status signals (blinks) keep running.
 */
const DECOR = [
  ".cv-flicker",
  ".cv-gas",
  ".cv-glow",
  ".cv-ray",
  ".cv-ripple",
  ".cv-wave",
  ".cv-mote",
  ".cv-spin",
  ".cv-spin-slow",
  ".cv-spin-rev",
  ".cv-bob",
  ".cv-pulse",
  ".cv-piston",
  ".cv-pend",
  ".cv-sparkle",
  ".cv-zzz",
  ".cv-purse",
  ".cv-hover",
  ".cv-key",
  ".cv-tap",
  ".cv-steam",
  ".cv-drip",
  ".cv-fall",
  ".cv-clump",
  // v3: every new decorative loop carries data-decor instead of joining this list
  "[data-decor]",
].join(",");

/** Keyframes and helper classes for the colony view (rendered once in a <style> tag by ColonyView). */
export const COLONY_CSS = `
.cv-fb{transform-box:fill-box;transform-origin:center}
.cv-fbb{transform-box:fill-box;transform-origin:50% 100%}
.cv-flicker{animation:cv-flicker 1.3s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 100%}
@keyframes cv-flicker{0%{opacity:.85;transform:scale(1,.92)}35%{opacity:1;transform:scale(.94,1.06)}70%{opacity:.9;transform:scale(1.04,.97)}100%{opacity:1;transform:scale(.97,1.04)}}
.cv-gas{animation:cv-gas .18s steps(2) infinite alternate;transform-box:fill-box;transform-origin:50% 100%}
@keyframes cv-gas{0%{opacity:.8;transform:scaleY(.94)}100%{opacity:1;transform:scaleY(1.05)}}
.cv-glow{animation:cv-glow 3.2s ease-in-out infinite alternate}
@keyframes cv-glow{0%{opacity:.35}100%{opacity:.95}}
.cv-ray{animation:cv-ray 5s ease-in-out infinite alternate}
@keyframes cv-ray{0%{opacity:.55}100%{opacity:1}}
.cv-drip{animation:cv-drip 2.6s cubic-bezier(.55,0,1,.45) infinite}
@keyframes cv-drip{0%,30%{transform:translateY(0);opacity:0}35%{opacity:1}100%{transform:translateY(var(--fall,150px));opacity:.9}}
.cv-ripple{animation:cv-ripple 2.6s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes cv-ripple{0%,97%{transform:scale(.1);opacity:0}98%{opacity:.9}100%{transform:scale(1.4);opacity:0}}
.cv-wave{animation:cv-wave 2.2s linear infinite}
@keyframes cv-wave{from{transform:translateX(0)}to{transform:translateX(-48px)}}
.cv-steam{animation:cv-steam 3.4s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes cv-steam{0%{transform:translate(0,0) scale(.5);opacity:0}15%{opacity:.55}100%{transform:translate(var(--dx,8px),-70px) scale(1.7);opacity:0}}
.cv-mote{animation:cv-mote 7s ease-in-out infinite alternate}
@keyframes cv-mote{0%{transform:translate(0,0);opacity:.2}50%{opacity:.8}100%{transform:translate(14px,40px);opacity:.15}}
.cv-spin{animation:cv-spin 6s linear infinite;transform-box:fill-box;transform-origin:center}
.cv-spin-slow{animation:cv-spin 18s linear infinite;transform-box:fill-box;transform-origin:center}
.cv-spin-rev{animation:cv-spin 6s linear infinite reverse;transform-box:fill-box;transform-origin:center}
@keyframes cv-spin{to{transform:rotate(360deg)}}
.cv-hand-m{animation:cv-spin 60s linear infinite;transform-origin:0 0}
.cv-hand-h{animation:cv-spin 720s linear infinite;transform-origin:0 0}
.cv-bob{animation:cv-bob 1.6s ease-in-out infinite alternate;transform-box:fill-box}
@keyframes cv-bob{from{transform:translateY(0)}to{transform:translateY(-4px)}}
.cv-pulse{animation:cv-pulse 1s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes cv-pulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.18);opacity:1}}
.cv-piston{animation:cv-piston 1.1s ease-in-out infinite}
@keyframes cv-piston{0%,100%{transform:translateY(0)}45%{transform:translateY(12px)}55%{transform:translateY(12px)}}
.cv-pend{animation:cv-pend 2s ease-in-out infinite alternate;transform-origin:0 0}
@keyframes cv-pend{from{transform:rotate(-14deg)}to{transform:rotate(14deg)}}
.cv-fall{animation:cv-fall 1.4s linear infinite}
@keyframes cv-fall{0%{transform:translateY(0);opacity:0}10%{opacity:1}90%{opacity:1}100%{transform:translateY(var(--fall,60px));opacity:0}}
.cv-pop{animation:cv-pop .6s cubic-bezier(.2,1.6,.4,1) both;transform-box:fill-box;transform-origin:50% 100%}
.cv-pop-late{animation-delay:.7s}
.cv-rm .cv-scaffold{display:none}
.cv-rm .cv-pop-late{animation-delay:0s}
.cv-scaffold{animation:cv-scaffold .8s linear both}
@keyframes cv-scaffold{0%{opacity:0}10%,80%{opacity:1}100%{opacity:0}}
.cv-ping-in{animation:cv-ping-in .2s ease-out both}
@keyframes cv-ping-in{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
@keyframes cv-pop{0%{transform:scale(.2);opacity:0}60%{transform:scale(1.12);opacity:1}100%{transform:scale(1)}}
.cv-boom{animation:cv-boom .9s ease-out both;transform-box:fill-box;transform-origin:center}
@keyframes cv-boom{0%{transform:scale(.4);opacity:0}25%{transform:scale(1.15);opacity:1}70%{opacity:1}100%{transform:scale(1) translateY(-14px);opacity:0}}
.cv-crack{stroke-dasharray:var(--len,300);stroke-dashoffset:var(--len,300);animation:cv-crack 5s ease-out forwards}
@keyframes cv-crack{to{stroke-dashoffset:0}}
.cv-clump{animation:cv-clump 1.2s ease-in infinite}
@keyframes cv-clump{0%{transform:translate(0,0) rotate(0);opacity:0}10%{opacity:1}100%{transform:translate(var(--dx,6px),90px) rotate(200deg);opacity:0}}
.cv-ring{animation:cv-ring 1.4s ease-out forwards;transform-box:fill-box;transform-origin:center}
@keyframes cv-ring{0%{transform:scale(.3);opacity:1}100%{transform:scale(1.7);opacity:0}}
.cv-badge{animation:cv-badge 1.8s cubic-bezier(.2,1.5,.4,1) forwards;transform-box:fill-box;transform-origin:center}
@keyframes cv-badge{0%{transform:scale(0)}20%{transform:scale(1.35)}35%{transform:scale(1)}80%{opacity:1;transform:translateY(-6px)}100%{opacity:0;transform:translateY(-22px)}}
.cv-flash{animation:cv-flash .7s ease-out forwards}
@keyframes cv-flash{0%{opacity:.9}100%{opacity:0}}
.cv-key{animation:cv-key .5s linear infinite;transform-box:fill-box;transform-origin:center}
@keyframes cv-key{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.15)}}
.cv-tap{animation:cv-tap 1s ease-in infinite;transform-box:fill-box;transform-origin:30% 100%}
@keyframes cv-tap{0%,60%{transform:rotate(0)}80%{transform:rotate(16deg)}100%{transform:rotate(0)}}
.cv-sparkle{animation:cv-sparkle 1.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes cv-sparkle{0%,100%{transform:scale(.6) rotate(0);opacity:.5}50%{transform:scale(1.2) rotate(45deg);opacity:1}}
.cv-zzz{animation:cv-zzz 2.4s ease-out infinite}
@keyframes cv-zzz{0%{transform:translate(0,0);opacity:0}20%{opacity:.9}100%{transform:translate(6px,-14px);opacity:0}}
.cv-purse{animation:cv-purse 1.6s linear infinite}
@keyframes cv-purse{0%{transform:rotateY(0)}100%{transform:rotateY(360deg)}}
.cv-hover{animation:cv-hover 1.4s ease-in-out infinite alternate}
@keyframes cv-hover{from{transform:translateY(0)}to{transform:translateY(-6px)}}
.cv-blink{animation:cv-blink .35s steps(2) infinite}
@keyframes cv-blink{0%{opacity:1}100%{opacity:.25}}
.cv-blink-late{animation:cv-blink .3s steps(2) 3.4s infinite}
.cv-frenzy{animation:cv-frenzy .7s ease-in-out infinite alternate}
@keyframes cv-frenzy{from{box-shadow:inset 0 0 18px 4px rgba(255,90,60,.55),inset 0 0 50px 8px rgba(255,200,80,.25)}to{box-shadow:inset 0 0 30px 8px rgba(255,180,60,.75),inset 0 0 80px 16px rgba(255,60,40,.35)}}
.cv-avral{animation:cv-avral .5s ease-in-out infinite alternate}
@keyframes cv-avral{from{transform:scale(1);color:#ffd34d}to{transform:scale(1.12);color:#ff6a4a}}
.cv-vibrate{animation:cv-vibrate .09s linear infinite alternate}
@keyframes cv-vibrate{from{transform:translateX(-1px)}to{transform:translateX(1px)}}
.cv-rm .cv-drip,.cv-rm .cv-ripple,.cv-rm .cv-steam,.cv-rm .cv-mote,.cv-rm .cv-clump,.cv-rm .cv-fall,.cv-rm .cv-wave,.cv-rm .cv-vibrate,.cv-rm .cv-frenzy,.cv-rm .cv-avral,.cv-rm .cv-flash{animation:none}
.cv-rm .cv-steam,.cv-rm .cv-drip,.cv-rm .cv-mote,.cv-rm .cv-clump,.cv-rm .cv-fall,.cv-rm .cv-flash{opacity:0}
[data-off],[data-off] *,.cv-covered *{animation-play-state:paused!important}
.cv-rm :is(${DECOR}){animation-play-state:paused}
@media (prefers-reduced-motion:reduce){.cv-root:not(.cv-motion) :is(${DECOR}){animation-play-state:paused}}
html[data-eco] .cv-root :is(${DECOR}),html[data-eco] .cv-rat,html[data-eco] .cv-rat *{animation-play-state:paused}
html[data-eco] :is(.cv-blink,.cv-blink-late,.cv-ping,.cv-vibrate,.cv-frenzy,.cv-avral,.cv-sniff,.cv-glove){animation-play-state:paused}
.cv-plate{transform:scale(var(--plate-k,1));transform-box:fill-box;transform-origin:100% 100%}
.cv-plate-l{transform:scale(var(--plate-k,1));transform-box:fill-box;transform-origin:0 100%}
.cv-tag{transform:scale(var(--plate-k,1));transform-origin:0 0}
.cv-idle{filter:saturate(.35) brightness(.7);transition:filter .4s}
.cv-ping{animation:cv-ping 1.4s cubic-bezier(0,0,.2,1) infinite}
@keyframes cv-ping{0%{transform:scale(1);opacity:.8}75%,100%{transform:scale(1.7);opacity:0}}
.cv-rm .cv-ping{animation:cv-blink 1s steps(2) infinite}
.cv-grate-ring{opacity:0;transition:opacity .15s}
g[role=button]:has(>.cv-grate-ring):focus{outline:none}
g[role=button]:focus-visible .cv-grate-ring{opacity:1}
.cv-litter{transform-box:fill-box;transform-origin:center}
.cv-sniff{animation:cv-sniff 3.6s ease-in-out infinite;transform-box:fill-box;transform-origin:40% 100%}
@keyframes cv-sniff{0%,52%,100%{transform:rotate(0)}58%{transform:rotate(-4deg)}62%{transform:rotate(-2deg)}66%{transform:rotate(-5deg)}74%,90%{transform:rotate(-14deg)}}
.cv-glove{animation:cv-glove 1s ease-in-out infinite;transform-box:fill-box}
@keyframes cv-glove{0%,100%{transform:translate(0,0)}50%{transform:translate(-3px,6px)}}
.cv-ray-in{animation:cv-ray-in 3s ease-in-out both}
@keyframes cv-ray-in{from{opacity:0}to{opacity:1}}
.cv-ray-out{animation:cv-ray-out 3s ease-in-out both}
@keyframes cv-ray-out{from{opacity:1}to{opacity:0}}
.cv-rumble{animation:cv-rumble 3s ease-in-out both}
@keyframes cv-rumble{0%{opacity:0}18%{opacity:1}70%{opacity:1}100%{opacity:0}}
/* 10-unit lettering at ≥ 10.4 css px: --plate-k is 1.158/s below its cap, so 0.9·k ≥ 1.04/s (the signboards are drawn over the chambers) */
.cv-sign{transform:scale(max(1,var(--plate-k,1)*.9));transform-box:fill-box;transform-origin:100% 0}
.cv-cap{transform:scale(max(1,var(--plate-k,1)*.9));transform-box:fill-box;transform-origin:50% 50%}
.cv-plaque{transform:scale(min(var(--plate-k,1),2));transform-box:fill-box;transform-origin:50% 50%}
.cv-tiny .cv-fine{display:none}
.cv-rat .cv-tail{transform-origin:-12px -6px;animation:cv-tail-idle 1.8s steps(3) infinite alternate}
.cv-lamp .cv-flicker{animation-timing-function:steps(2)}
@keyframes cv-tail-idle{from{transform:rotate(-4deg)}to{transform:rotate(5deg)}}
.cv-rat.cv-walk .cv-tail{animation:cv-tail .44s ease-in-out infinite alternate}
@keyframes cv-tail{from{transform:rotate(-10deg)}to{transform:rotate(10deg)}}
.cv-walk .cv-foot-a,.cv-walk .cv-foot-b{animation:cv-step .22s steps(2) infinite}
.cv-walk .cv-foot-b{animation-delay:-.11s}
@keyframes cv-step{from{transform:translateY(0)}to{transform:translateY(-2.8px)}}
.cv-roll-in{animation:cv-roll-in .3s ease-out both}
@keyframes cv-roll-in{from{transform:translateY(-15px)}to{transform:translateY(0)}}
.cv-roll-out{animation:cv-roll-out .3s ease-in both}
@keyframes cv-roll-out{from{transform:translateY(0)}to{transform:translateY(15px)}}
.cv-rm .cv-roll-out{display:none}
.cv-rm .cv-roll-in{animation:none}
.cv-badge.cv-bulk{animation-duration:1.2s}
.cv-rm .cv-badge.cv-bulk{animation:cv-fade-out 1.2s ease-in both}
@keyframes cv-fade-out{0%,60%{opacity:1}100%{opacity:0}}
.cv-grow{animation:cv-grow .7s cubic-bezier(.3,.7,.4,1) both;transform-box:fill-box;transform-origin:50% 0}
@keyframes cv-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.cv-bloom{animation:cv-bloom .6s cubic-bezier(.2,.8,.3,1) both;transform-box:fill-box;transform-origin:center}
@keyframes cv-bloom{from{transform:scale(0)}to{transform:scale(1)}}
.cv-veil{animation:cv-veil 2.9s linear both}
@keyframes cv-veil{0%,76%{opacity:1}100%{opacity:0}}
.cv-veil-rm{animation:cv-veil-rm .4s ease-in both}
@keyframes cv-veil-rm{from{opacity:1}to{opacity:0}}
.cv-drop{animation:cv-drop .8s cubic-bezier(.3,1.4,.5,1) 1s both}
@keyframes cv-drop{from{transform:translateY(-34px);opacity:0}25%{opacity:1}to{transform:translateY(0)}}
.cv-rm .cv-grow,.cv-rm .cv-drop{animation:none}
.cv-loco>svg{width:216px;height:79.2px;overflow:visible}
/* the nested panel Locomotive (×0.6) letters at ~3 css px on phones: the «+N вагонов» pill goes whole, the matchbox loses its word */
.cv-tiny .cv-loco text,.cv-tiny .cv-loco svg>g:has(>text:last-child){display:none}
`;
