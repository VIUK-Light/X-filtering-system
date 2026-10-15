import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "dist", "model-poc");
const ortDist = path.join(projectRoot, "node_modules", "onnxruntime-web", "dist");

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, "ort"), { recursive: true });
await cp(path.join(projectRoot, "model-poc", "web", "index.html"), path.join(outputDir, "index.html"));
await cp(path.join(projectRoot, "model-poc", "web", "bench.css"), path.join(outputDir, "bench.css"));
const wasmAssets = (await readdir(ortDist)).filter((name) => name.endsWith(".wasm") || name.endsWith(".mjs"));
for (const asset of wasmAssets) {
  await cp(path.join(ortDist, asset), path.join(outputDir, "ort", asset));
}

execFileSync(
  path.join(projectRoot, "node_modules", "esbuild", "bin", "esbuild"),
  [
    "model-poc/web/bench.ts",
    "--bundle",
    "--platform=browser",
    "--format=iife",
    "--target=chrome120",
    `--outfile=${path.join(outputDir, "bench.js")}`,
  ],
  { cwd: projectRoot, stdio: "inherit" },
);

console.log(`Built ONNX Runtime Web probe in ${path.relative(projectRoot, outputDir)}`);
