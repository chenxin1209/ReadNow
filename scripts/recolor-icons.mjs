import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as upngModule from "@pdf-lib/upng";

const UPNG = upngModule.default.default;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconFiles = [
  path.join(root, "docs", "icon.png"),
  ...[16, 32, 48, 96, 128].map((size) =>
    path.join(root, "static", "icons", `deepread-${size}.png`),
  ),
];

function hueToRgb(p, q, input) {
  let t = input;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

for (const file of iconFiles) {
  const source = fs.readFileSync(file);
  const image = UPNG.decode(source);
  const rgba = new Uint8Array(UPNG.toRGBA8(image)[0]);
  for (let index = 0; index < rgba.length; index += 4) {
    const r = rgba[index];
    const g = rgba[index + 1];
    const b = rgba[index + 2];
    if (!rgba[index + 3] || g - r < 12 || g <= b * 1.08) continue;
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const lightness = (max + min) / 2;
    const saturation = Math.min(0.42, Math.max(0.32, (max - min) / Math.max(0.01, 1 - Math.abs(2 * lightness - 1)) * 0.72));
    const blueLightness = Math.min(0.62, 0.34 + lightness * 0.7);
    const [nr, ng, nb] = hslToRgb(212 / 360, saturation, blueLightness);
    rgba[index] = Math.round(nr * 255);
    rgba[index + 1] = Math.round(ng * 255);
    rgba[index + 2] = Math.round(nb * 255);
  }
  const encoded = UPNG.encode([rgba.buffer], image.width, image.height, 0);
  fs.writeFileSync(file, Buffer.from(encoded));
}

console.log(`Recolored ${iconFiles.length} ReadNow icons.`);
