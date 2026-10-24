/**
 * The Rat King mark (SH-6): the same art as app/icon.svg, as a data URI for the generated PNG icons and the
 * link preview (ImageResponse draws it with <img>). No game imports.
 */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M20 12 L22 4 L27 9 L31 2 L35 9 L40 4 L42 12 Z" fill="#c9a25a" stroke="#7d5f2c" stroke-width="1.2" stroke-linejoin="round"/>
<rect x="19.5" y="11" width="23" height="3.5" rx="1.2" fill="#c9a25a"/>
<circle cx="22" cy="22" r="7" fill="#c9a25a"/>
<circle cx="22" cy="22" r="3.6" fill="#14110f" opacity=".55"/>
<path d="M14 34 Q14 18 31 17 Q46 17 55 33 Q58 38 54 40 Q44 46 31 46 Q17 46 14 34 Z" fill="#c9a25a"/>
<circle cx="41" cy="29" r="2.6" fill="#14110f"/>
<circle cx="41.8" cy="28.2" r=".8" fill="#e8c983"/>
<circle cx="56" cy="37" r="2.4" fill="#e98a96"/>
<path d="M50 39 L62 37 M50 41 L62 42" stroke="#e8c983" stroke-width="1" stroke-linecap="round"/>
<path d="M15 40 Q6 48 10 56 Q13 61 20 58" fill="none" stroke="#c9a25a" stroke-width="3" stroke-linecap="round"/>
</svg>`;

export const SOOT = "#14110f";
export const BRASS = "#c9a25a";

export const MARK_URI = `data:image/svg+xml;base64,${Buffer.from(MARK).toString("base64")}`;

/** A giant train wheel for the link preview. */
const WHEEL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200">
<circle r="94" fill="none" stroke="#3a3f45" stroke-width="10"/>
<circle r="84" fill="none" stroke="#7d5f2c" stroke-width="8"/>
${Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return `<line x1="0" y1="0" x2="${(Math.cos(a) * 80).toFixed(1)}" y2="${(Math.sin(a) * 80).toFixed(1)}" stroke="#4a3f35" stroke-width="5"/>`;
}).join("")}
<circle r="16" fill="#2b231d" stroke="#c9a25a" stroke-width="3"/>
</svg>`;

export const WHEEL_URI = `data:image/svg+xml;base64,${Buffer.from(WHEEL).toString("base64")}`;
