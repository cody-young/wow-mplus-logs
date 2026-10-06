/**
 * MDT's map tiles, read from the user's own install for the map tab.
 *
 * MDT draws each floor from 150 PNG tiles in a folder its dungeon file names.
 * They are read here and handed over as data URLs, never copied into the app:
 * the art is MDT's, and MDT is GPL-2.0. A floor is about a megabyte of tiles.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { MDT_TILES, mdtTileName } from '@mplus/data';

/** Floors already read, by absolute folder and sublevel. A run's map is asked for every time its tab opens. */
const cache = new Map<string, Promise<Array<string | null>>>();
const MAX_CACHED = 4;

/**
 * One floor's tiles, in MDT's order, or null for a request that does not name
 * a folder inside `mdtDirectory`.
 *
 * The folder comes from the renderer, so it is checked to stay inside MDT's:
 * this handler reads files, and must not read any but MDT's tiles.
 */
export async function mdtTiles(
  mdtDirectory: string,
  textureDir: unknown,
  sublevel: unknown,
): Promise<Array<string | null> | null> {
  if (typeof textureDir !== 'string' || typeof sublevel !== 'number' || !Number.isInteger(sublevel) || sublevel < 1) {
    return null;
  }
  const root = resolve(mdtDirectory);
  const folder = resolve(root, textureDir);
  const inside = relative(root, folder);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null;

  const key = `${folder}\0${sublevel}`;
  let tiles = cache.get(key);
  if (tiles === undefined) {
    tiles = read(folder, sublevel);
    cache.set(key, tiles);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  }
  return tiles;
}

async function read(folder: string, sublevel: number): Promise<Array<string | null>> {
  const names: string[] = [];
  for (let row = 0; row < MDT_TILES.rows; row++) {
    for (let column = 0; column < MDT_TILES.columns; column++) names.push(mdtTileName(sublevel, row, column));
  }
  return Promise.all(
    names.map(async (name) => {
      try {
        const bytes = await readFile(join(folder, name));
        return `data:image/png;base64,${bytes.toString('base64')}`;
      } catch {
        return null;
      }
    }),
  );
}
