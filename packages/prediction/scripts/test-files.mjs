import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// 階層が増えても回帰を収集する。例・fixtureは.test.mjsの対象外。
export function collectTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .flatMap(entry => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTestFiles(path);
      }
      if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        return [path];
      }
      return [];
    });
}
