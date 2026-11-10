import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function resolveEsbuildBinary() {
  if (process.env.ESBUILD_BINARY_PATH) return process.env.ESBUILD_BINARY_PATH;
  const platformPackage = `${process.platform}-${process.arch}`;
  const candidates = [
    path.join(root, "node_modules", "@esbuild", platformPackage, "esbuild.exe"),
    path.join(root, "node_modules", "@esbuild", platformPackage, "bin", "esbuild"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const pnpmDir = path.join(root, "node_modules", ".pnpm");
    if (fs.existsSync(pnpmDir)) {
      const folder = fs
        .readdirSync(pnpmDir)
        .find((name) => name.startsWith(`@esbuild+${platformPackage}@`));
      if (folder) {
        const binary = path.join(
          pnpmDir,
          folder,
          "node_modules",
          "@esbuild",
          platformPackage,
          process.platform === "win32" ? "esbuild.exe" : "bin/esbuild",
        );
        if (fs.existsSync(binary)) return binary;
      }
    }
  } catch {
    // Fall through to the error below.
  }
  throw new Error(
    `esbuild binary not found for ${platformPackage}. Run "pnpm install" and make sure optional dependencies are enabled.`,
  );
}

function walkFiles(dir, base = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full, base));
    else files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  rmrf(dist);
  fs.mkdirSync(dist, { recursive: true });

  fs.copyFileSync(path.join(root, "manifest.json"), path.join(dist, "manifest.json"));
  fs.copyFileSync(path.join(root, "bootstrap.js"), path.join(dist, "bootstrap.js"));
  fs.copyFileSync(path.join(root, "prefs.js"), path.join(dist, "prefs.js"));
  copyDir(path.join(root, "static"), path.join(dist, "content"));

  const esbuildBinary = resolveEsbuildBinary();
  const outfile = path.join(dist, "content", "scripts", "deepread.js");
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  const args = [
    path.join(root, "src", "main.js"),
    "--bundle",
    "--format=iife",
    "--platform=browser",
    "--target=firefox115",
    `--outfile=${outfile}`,
    "--loader:.css=text",
    "--loader:.woff2=binary",
    "--legal-comments=none",
    '--define:process.env.NODE_ENV="production"',
    "--log-level=info",
    "--banner:js=/* ReadNow for Zotero — bundled by scripts/build.mjs. Source: src/ */",
  ];
  const result = spawnSync(esbuildBinary, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`esbuild exited with status ${result.status}`);

  const files = walkFiles(dist);
  const buffer = createZip(
    files.map((relative) => ({
      name: relative,
      data: fs.readFileSync(path.join(dist, relative)),
    })),
  );
  const xpiName = `ReadNow-${manifest.version}.xpi`;
  const xpiPath = path.join(root, xpiName);
  fs.writeFileSync(xpiPath, buffer);

  const bundlePath = path.join(dist, "content", "scripts", "deepread.js");
  const bundleHash = sha256(fs.readFileSync(bundlePath));
  const xpiHash = sha256(buffer);
  fs.writeFileSync(
    path.join(root, "dist", "build-info.json"),
    JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        builtAt: new Date().toISOString(),
        bundleBytes: fs.statSync(bundlePath).size,
        bundleSha256: bundleHash,
        xpi: xpiName,
        xpiBytes: buffer.length,
        xpiSha256: xpiHash,
      },
      null,
      2,
    ),
  );

  console.log("");
  console.log(`Built ${xpiName}`);
  console.log(`  XPI:    ${(buffer.length / 1024 / 1024).toFixed(2)} MB  sha256=${xpiHash}`);
  console.log(`  Bundle: ${(fs.statSync(bundlePath).size / 1024).toFixed(0)} KB  sha256=${bundleHash}`);
  console.log(`  Files:  ${files.length}`);
  console.log("");
  console.log("Install: Zotero → Tools → Add-ons → gear → Install Add-on From File…");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
