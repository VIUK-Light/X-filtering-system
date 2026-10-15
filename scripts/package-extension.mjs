import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(projectRoot, "dist", "edge");
const outputRoot = path.join(projectRoot, "release");
const browserTarget = process.argv[2] ?? "edge";
if (browserTarget !== "edge" && browserTarget !== "chrome") {
  throw new Error("Browser target must be 'edge' or 'chrome'.");
}
console.log(`Preparing ${browserTarget} upload archive...`);
const manifestPath = path.join(extensionRoot, "manifest.json");
if (!(await stat(manifestPath).catch(() => null))) {
  throw new Error("Build the extension before packaging it (npm run build).");
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (typeof manifest.version !== "string" || !/^\d+(\.\d+){1,3}$/.test(manifest.version)) {
  throw new Error("The built manifest must contain a numeric extension version.");
}
const packageName = `x-filtering-system-${browserTarget}-${manifest.version}.zip`;
const outputFile = path.join(outputRoot, packageName);

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

await mkdir(outputRoot, { recursive: true });
const zip = new yazl.ZipFile();
const output = createWriteStream(outputFile);
zip.outputStream.pipe(output);

const files = await listFiles(extensionRoot);
console.log(`Adding ${files.length} files...`);
for (const file of files) {
  zip.addFile(file, path.relative(extensionRoot, file).split(path.sep).join("/"));
}

zip.end();
await once(output, "close");
console.log(`Packaged ${path.relative(projectRoot, outputFile)}`);
