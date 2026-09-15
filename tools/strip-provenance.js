// Remove APP11 (0xFFEB) provenance blocks from the images in public/img.
//
// Files that travel through some delivery pipelines pick up a C2PA
// "Content Credentials" manifest stating that an AI may have created or
// modified them. That is untrue of these photographs and misleading on this
// site in particular, so it is stripped before anything is published.
//
// Only the APP11 segment is removed. Image data is not re-encoded.
//
//   node tools/strip-provenance.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function stripJpeg(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;     // not a JPEG
  const keep = [buf.subarray(0, 2)];
  let i = 2, removed = 0;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xFF) break;
    const marker = buf[i + 1];
    if (marker === 0xDA) { keep.push(buf.subarray(i)); i = buf.length; break; }
    if (marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      keep.push(buf.subarray(i, i + 2)); i += 2; continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xEB) removed += len + 2;               // APP11: drop it
    else keep.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return removed ? { out: Buffer.concat(keep), removed } : null;
}

function stripPng(buf) {
  const SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (!buf.subarray(0, 8).equals(SIG)) return null;
  const keep = [buf.subarray(0, 8)];
  let i = 8, removed = 0;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const total = 12 + len;
    // caBX carries C2PA in PNG; iTXt/tEXt can carry the XMP pointer to it
    const drop = type === 'caBX' ||
      ((type === 'iTXt' || type === 'tEXt') &&
        buf.toString('latin1', i + 8, i + 8 + Math.min(len, 64)).includes('c2pa'));
    if (drop) removed += total;
    else keep.push(buf.subarray(i, i + total));
    i += total;
  }
  return removed ? { out: Buffer.concat(keep), removed } : null;
}

let touched = 0, saved = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) continue;
    const buf = fs.readFileSync(full);
    const res = ext === '.png' ? stripPng(buf) : stripJpeg(buf);
    if (!res) continue;
    fs.writeFileSync(full, res.out);
    touched++; saved += res.removed;
    console.log(`  stripped ${res.removed} bytes from ${path.relative(DIR, full)}`);
  }
}
walk(DIR);
console.log(touched
  ? `\n${touched} file(s) cleaned, ${(saved / 1024).toFixed(1)} KB removed.`
  : 'Nothing to strip — all images are already clean.');
