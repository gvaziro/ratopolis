// Checks a static export the way GitHub Pages will serve it (REP-3): every local href/src and every _next/static
// chunk named in out/index.html, and the web manifest's start_url, scope and icons, must resolve to a file in out/
// under the basePath. Exits 1 on a missing file or a root-relative path that forgot the basePath.
//   node .github/scripts/check-export.mjs [outDir=out] [basePath=$BASE_PATH]
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const [outDir = "out", baseArg = process.env.BASE_PATH ?? ""] = process.argv.slice(2);
const base = baseArg.trim().replace(/\/+$/, "");
const basePath = base && !base.startsWith("/") ? `/${base}` : base;
if (/[:\\]/.test(basePath)) {
  // Git Bash on Windows rewrites a /path argument into "C:/Program Files/Git/path"
  console.error(`The basePath must be a URL path such as /ratopolis, got "${baseArg}". In Git Bash prefix the command with MSYS_NO_PATHCONV=1.`);
  process.exit(2);
}
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
const gha = !!process.env.GITHUB_ACTIONS;
const errors = [];
const warnings = [];
const seen = new Set();

const isFile = (p) => existsSync(p) && statSync(p).isFile();

/** The file a static host serves for this URL path, or null. */
function fileFor(urlPath) {
  if (basePath && urlPath !== basePath && !urlPath.startsWith(`${basePath}/`)) return null;
  const rel = decodeURIComponent(urlPath.slice(basePath.length)) || "/";
  const p = path.join(outDir, rel);
  const tries = rel.endsWith("/") ? [path.join(p, "index.html")] : [p, `${p}.html`, path.join(p, "index.html")];
  return tries.find(isFile) ?? null;
}

/** Checks one reference found in `where`, resolved against the page URL `from` (a path under the basePath). */
function check(ref, from, where) {
  const raw = ref.trim().replace(/&amp;/g, "&");
  if (!raw || raw.startsWith("#") || raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return;
  const url = new URL(raw, `http://export.local${from}`);
  const key = `${url.pathname} ${where}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
    errors.push(`${where}: ${raw} is outside the basePath ${basePath} (a root-relative path without it)`);
    return;
  }
  if (!fileFor(url.pathname)) errors.push(`${where}: ${raw} → no file in ${outDir}/ for ${url.pathname}`);
}

const pageUrl = `${basePath}/`;
const indexFile = path.join(outDir, "index.html");
if (!isFile(indexFile)) {
  console.error(`${indexFile} is missing: was the build run with STATIC_EXPORT=1 (npm run build:static)?`);
  process.exit(1);
}
const html = readFileSync(indexFile, "utf8");

for (const m of html.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) check(m[1] ?? m[2], pageUrl, "index.html");
for (const m of html.matchAll(/\s(?:srcset|imagesrcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
  for (const part of (m[1] ?? m[2]).split(",")) check(part.trim().split(/\s+/)[0], pageUrl, "index.html srcset");
}
// chunks the RSC payload and the bootstrap scripts load later
for (const m of html.matchAll(new RegExp(`${basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/_next/static/[^"'\\\\\\s)]+`, "g"))) {
  check(m[0], pageUrl, "index.html (payload)");
}

const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1];
if (og) {
  if (!og.startsWith("https://")) warnings.push(`og:image is not an absolute https URL: ${og} (set NEXT_PUBLIC_SITE_URL)`);
  else if (siteUrl && og.startsWith(`${siteUrl}/`)) check(new URL(og).pathname, pageUrl, "og:image");
}

const manifestHref = html.match(/<link[^>]+rel="manifest"[^>]*>/i)?.[0].match(/href="([^"]+)"/i)?.[1];
if (!manifestHref) warnings.push("index.html links no web manifest");
else {
  check(manifestHref, pageUrl, "manifest link");
  const manifestUrl = new URL(manifestHref.replace(/&amp;/g, "&"), `http://export.local${pageUrl}`).pathname;
  const manifestFile = fileFor(manifestUrl);
  if (manifestFile) {
    let manifest = null;
    try {
      manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    } catch (e) {
      errors.push(`manifest ${manifestUrl} is not JSON: ${e.message}`);
    }
    if (manifest) {
      for (const k of ["start_url", "scope"]) if (manifest[k]) check(manifest[k], manifestUrl, `manifest ${k}`);
      for (const icon of manifest.icons ?? []) {
        check(icon.src, manifestUrl, "manifest icon");
        const file = new URL(icon.src, `http://export.local${manifestUrl}`).pathname;
        if (!path.extname(file)) warnings.push(`manifest icon ${icon.src} has no file extension: static hosts serve it as application/octet-stream`);
      }
    }
  }
}

for (const w of warnings) console.log(gha ? `::warning title=Static export::${w}` : `warning: ${w}`);
for (const e of errors) console.log(gha ? `::error title=Static export::${e}` : `error: ${e}`);
console.log(`${seen.size} references checked in ${outDir}/ under "${basePath || "/"}": ${errors.length} missing, ${warnings.length} warnings.`);
process.exit(errors.length ? 1 : 0);
