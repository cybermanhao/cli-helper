import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createSnapshot, diffSnapshots, storeSessionChanges, getSessionChanges } from '../src/modules/snapshot.js';
import { initDb } from '../src/modules/db.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'));
  process.env.CLI_HELPER_CONFIG_DIR = tempDir;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('snapshot module', () => {
  it('createSnapshot captures files', () => {
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'hello');
    fs.mkdirSync(path.join(tempDir, 'sub'));
    fs.writeFileSync(path.join(tempDir, 'sub', 'b.txt'), 'world');

    const snap = createSnapshot(tempDir);
    expect(snap.dir).toBe(tempDir);
    expect(snap.files.length).toBe(2);
    expect(snap.files.some(f => f.relPath === 'a.txt')).toBe(true);
    expect(snap.files.some(f => f.relPath === 'sub/b.txt')).toBe(true);
  });

  it('diffSnapshots detects added files', () => {
    const before = createSnapshot(tempDir);
    fs.writeFileSync(path.join(tempDir, 'new.txt'), 'new content');
    const after = createSnapshot(tempDir);

    const diff = diffSnapshots(before, after);
    expect(diff.added.length).toBe(1);
    expect(diff.added[0].relPath).toBe('new.txt');
    expect(diff.modified.length).toBe(0);
    expect(diff.removed.length).toBe(0);
  });

  it('diffSnapshots detects modified files', () => {
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'original');
    const before = createSnapshot(tempDir);

    // Wait a bit to ensure mtime changes
    const start = Date.now();
    while (Date.now() - start < 50) { /* busy wait for mtime */ }
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'modified');
    const after = createSnapshot(tempDir);

    const diff = diffSnapshots(before, after);
    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0].relPath).toBe('file.txt');
  });

  it('diffSnapshots detects removed files', () => {
    fs.writeFileSync(path.join(tempDir, 'gone.txt'), 'temporary');
    const before = createSnapshot(tempDir);
    fs.unlinkSync(path.join(tempDir, 'gone.txt'));
    const after = createSnapshot(tempDir);

    const diff = diffSnapshots(before, after);
    expect(diff.removed.length).toBe(1);
    expect(diff.removed[0].relPath).toBe('gone.txt');
  });

  it('ignores node_modules and .git', () => {
    fs.mkdirSync(path.join(tempDir, 'node_modules'));
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'pkg.js'), 'code');
    fs.mkdirSync(path.join(tempDir, '.git'));
    fs.writeFileSync(path.join(tempDir, '.git', 'config'), 'config');

    const snap = createSnapshot(tempDir);
    expect(snap.files.length).toBe(0);
  });

  it('storeSessionChanges persists to SQLite', () => {
    initDb();
    const diff = { added: [{ relPath: 'x.txt', mtimeMs: 1, size: 2 }], modified: [], removed: [] };
    storeSessionChanges('sess-1', diff);
    const loaded = getSessionChanges('sess-1');
    expect(loaded).toBeDefined();
    expect(loaded?.added.length).toBe(1);
  });
});
