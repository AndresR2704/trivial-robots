// Build de l'interface web : web/src (TypeScript) + web/public -> web/dist/www
//
//   node build.mjs          build unique (utilisé par Gradle avant chaque APK)
//   node build.mjs --serve  rebuild à chaque modification + serveur http://localhost:8000
//
// Sortie : un seul script classique (IIFE) pour fonctionner en file:// dans la WebView.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const OUT_DIR = "dist/www";
const serve = process.argv.includes("--serve");

/** Copie web/public (index.html, style.css…) dans la sortie à chaque build. */
const copyPublic = {
  name: "copy-public",
  setup(build) {
    build.onEnd(() => cpSync("public", OUT_DIR, { recursive: true }));
  },
};

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const options = {
  entryPoints: ["src/main.ts"],
  outfile: `${OUT_DIR}/app.js`,
  bundle: true,
  format: "iife",
  target: "es2017", // WebView Android 7+ (minSdk 24)
  sourcemap: serve ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
  plugins: [copyPublic],
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: OUT_DIR, port: 8000 });
  console.log(`Interface : http://localhost:${port}/  (Ctrl+C pour arrêter)`);
} else {
  await esbuild.build(options);
}
