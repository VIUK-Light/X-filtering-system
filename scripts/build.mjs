import { cp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, "..");
const outputDir = path.join(projectRoot, "dist", "edge");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
console.log("Copying Chromium extension static files...");
await cp(path.join(projectRoot, "extension"), outputDir, { recursive: true });
console.log("Bundling Chromium extension scripts...");

const entries = [
  ["service-worker", "src/extension/service-worker.ts", "esm"],
  ["content-script", "src/extension/content-script.ts", "iife"],
  ["options", "src/extension/options.ts", "iife"],
  ["blocked-page", "src/extension/blocked-page.ts", "iife"],
];

for (const [name, entry, format] of entries) {
  console.log(`Bundling ${name}...`);
  execFileSync(
    path.join(projectRoot, "node_modules", "esbuild", "bin", "esbuild"),
    [
      entry,
      "--bundle",
      "--platform=browser",
      `--format=${format}`,
      "--target=chrome120",
      `--outfile=${path.join(outputDir, `${name}.js`)}`,
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );
  console.log(`Bundled ${name}.`);
}

console.log(`Built unpacked Chromium extension in ${path.relative(projectRoot, outputDir)}`);
