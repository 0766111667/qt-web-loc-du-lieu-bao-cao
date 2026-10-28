import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

export async function loadImage(name) {
  const { data, info } = await sharp(new URL(`./fixtures/${name}`, import.meta.url).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}
export const expected = JSON.parse(await readFile(new URL('./fixtures/expected.json', import.meta.url), 'utf8'));
export const seeds = JSON.parse(await readFile(new URL('../src/core/seeds.json', import.meta.url), 'utf8'));
