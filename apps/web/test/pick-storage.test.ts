import { describe, expect, it } from 'vitest';
import {
  clearCachedPick,
  readCachedPick,
  writeCachedPick,
  type KeyValueStorage,
} from '@/lib/pick-storage';

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('pick-storage (per-device "my pick" cache, see SPEC-GAP note)', () => {
  it('round-trips a cached pick', () => {
    const storage = memoryStorage();
    const pick = {
      pickId: 'p1',
      side: 'yes' as const,
      pickedAtIso: '2026-07-19T13:00:00Z',
      undoUntilIso: '2026-07-19T13:01:00Z',
    };
    writeCachedPick(storage, 'q1', pick);
    expect(readCachedPick(storage, 'q1')).toEqual(pick);
  });

  it('returns null for a question with no cached pick', () => {
    const storage = memoryStorage();
    expect(readCachedPick(storage, 'unknown')).toBeNull();
  });

  it('keys by question id — different questions never collide', () => {
    const storage = memoryStorage();
    const p1 = { pickId: 'p1', side: 'yes' as const, pickedAtIso: 'x', undoUntilIso: 'y' };
    const p2 = { pickId: 'p2', side: 'no' as const, pickedAtIso: 'x', undoUntilIso: 'y' };
    writeCachedPick(storage, 'q1', p1);
    writeCachedPick(storage, 'q2', p2);
    expect(readCachedPick(storage, 'q1')).toEqual(p1);
    expect(readCachedPick(storage, 'q2')).toEqual(p2);
  });

  it('clear removes the cached entry', () => {
    const storage = memoryStorage();
    writeCachedPick(storage, 'q1', {
      pickId: 'p1',
      side: 'yes',
      pickedAtIso: 'x',
      undoUntilIso: 'y',
    });
    clearCachedPick(storage, 'q1');
    expect(readCachedPick(storage, 'q1')).toBeNull();
  });

  it('a malformed/corrupt entry reads as null rather than throwing', () => {
    const storage = memoryStorage();
    storage.setItem('receipts:pick:q1', '{not json');
    expect(readCachedPick(storage, 'q1')).toBeNull();
  });

  it('an entry missing required fields reads as null', () => {
    const storage = memoryStorage();
    storage.setItem('receipts:pick:q1', JSON.stringify({ pickId: 'p1' }));
    expect(readCachedPick(storage, 'q1')).toBeNull();
  });

  it('a storage that throws (private-browsing quota, etc.) never propagates', () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('quota');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => readCachedPick(throwing, 'q1')).not.toThrow();
    expect(() =>
      writeCachedPick(throwing, 'q1', {
        pickId: 'p',
        side: 'yes',
        pickedAtIso: 'x',
        undoUntilIso: 'y',
      }),
    ).not.toThrow();
    expect(() => clearCachedPick(throwing, 'q1')).not.toThrow();
  });
});
