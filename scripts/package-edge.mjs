import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(projectRoot, "dist", "edge");
const outputRoot = path.join(projectRoot, "release");
const outputFile = path.join(outputRoot, "x-filtering-system-edge-0.1.0.zip");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

if (!(await stat(path.join(extensionRoot, "manifest.json")).catch(() => null))) {
  throw new Error("Build the extension before packaging it (npm run build).");
}

await mkdir(outputRoot, { recursive: true });
const zip = new yazl.ZipFile();
const output = createWriteStream(outputFile);
zip.outputStream.pipe(output);

for (const file of await listFiles(extensionRoot)) {
  zip.addFile(file, path.relative(extensionRoot, file).split(path.sep).join("/"));
}

zip.end();
await once(output, "close");
console.log(`Packaged ${path.relative(projectRoot, outputFile)}`);
