import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, 'icon.jpg');

const buf = readFileSync(src);

// Generate PNGs at each size
const sizes = [16, 32, 48, 64, 128, 256, 512];
const pngs = [];
for (const size of sizes) {
  const pngBuf = await sharp(buf).resize(size, size).png().toBuffer();
  writeFileSync(path.join(__dirname, `icon-${size}.png`), pngBuf);
  console.log(`  OK: icon-${size}.png`);
  if (size <= 256) pngs.push(pngBuf);
}

// Generate .ico (from sizes up to 256)
const icoBuf = await pngToIco(pngs);
writeFileSync(path.join(__dirname, 'icon.ico'), icoBuf);
console.log('  OK: icon.ico');

// Extra: 256x256 alias
writeFileSync(path.join(__dirname, 'icon-256.png'), await sharp(buf).resize(256, 256).png().toBuffer());
console.log('  OK: icon-256.png (alias)');

console.log('>> Done!');
