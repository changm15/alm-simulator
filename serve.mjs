#!/usr/bin/env node
/**
 * Zero-dependency static server for the production build.
 *
 * Deliberately not `vite preview`: this runs under launchd long after the dev
 * tooling is irrelevant, so it depends on nothing but Node itself. Binds all
 * interfaces so the phone on the same Wi-Fi can reach it.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const ROOT = resolve(fileURLToPath(new URL("./dist", import.meta.url)));
const PORT = Number(process.env.PORT ?? 5178);
const HOST = process.env.HOST ?? "0.0.0.0";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

async function resolveFile(urlPath) {
  // normalize() collapses "..", and the prefix check rejects anything that
  // still escapes the build directory.
  const candidate = resolve(join(ROOT, normalize(decodeURIComponent(urlPath))));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + "/")) return null;
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) return resolveFile(join(urlPath, "index.html"));
    return candidate;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  // Single-page app: unknown paths fall back to the shell rather than 404ing.
  const file = (await resolveFile(path)) ?? (await resolveFile("/index.html"));

  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Build not found. Run `npm run build` first.");
    return;
  }

  const ext = extname(file);
  const hashed = /-[A-Za-z0-9_-]{8,}\./.test(file);
  res.writeHead(200, {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    // Vite fingerprints asset filenames, so they are safe to cache hard; the
    // HTML shell that points at them must never be.
    "cache-control": hashed
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
  console.log(`[alm-simulator] serving ${ROOT}`);
  console.log(`  local   http://localhost:${PORT}`);
  lan.forEach((a) => console.log(`  network http://${a}:${PORT}`));
});
