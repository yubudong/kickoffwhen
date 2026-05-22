import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, 'og-image.svg');
const out = resolve(here, '..', 'public', 'og-image.png');

const svg = readFileSync(src);

await sharp(svg)
  .resize(1200, 630, { fit: 'contain', background: '#0A1929' })
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log(`Wrote ${out}`);
