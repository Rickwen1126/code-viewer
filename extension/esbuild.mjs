import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode", "bufferutil", "utf-8-validate"],
  format: "cjs",
  platform: "node",
  target: "node22",
  sourcemap: true,
  minify: !watch,
};

if (watch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(config);
  console.log("Build complete.");
}
