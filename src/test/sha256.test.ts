/**
 * SHA-256 conformance.
 *
 * The checksum shown next to a backup is only worth printing if it is the same
 * number `sha256sum` and `certutil` produce. These are the FIPS 180-4 example
 * vectors plus the two chunk-boundary cases a hand-rolled implementation gets
 * wrong: a message of exactly 55 bytes (padding still fits in the last block)
 * and one of exactly 56 (it does not, and an extra block is required).
 */
import { describe, it, expect } from 'vitest';
import { Sha256, sha256Hex } from '@/lib/sha256';

const enc = (s: string) => new TextEncoder().encode(s);

describe('sha256', () => {
  it('hashes the empty string', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc" (FIPS 180-4 one-block example)', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the 56-byte two-block example', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes 55 bytes — padding fits the final block', () => {
    expect(sha256Hex('a'.repeat(55))).toBe(
      '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
    );
  });

  it('hashes 56 bytes — padding forces an extra block', () => {
    expect(sha256Hex('a'.repeat(56))).toBe(
      'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
    );
  });

  it('hashes one million "a"s', () => {
    const h = new Sha256();
    const chunk = enc('a'.repeat(1000));
    for (let i = 0; i < 1000; i++) h.update(chunk);
    expect(h.hex()).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('gives the same digest however the stream is chopped up', () => {
    const message = 'The database was backed up at 02:00 and nobody checked. '.repeat(37);
    const oneShot = sha256Hex(message);

    const bytes = enc(message);
    for (const size of [1, 7, 63, 64, 65, 200]) {
      const h = new Sha256();
      for (let i = 0; i < bytes.length; i += size) h.update(bytes.subarray(i, i + size));
      expect(h.hex(), `chunk size ${size}`).toBe(oneShot);
    }
  });

  it('counts the bytes it has seen', () => {
    const h = new Sha256();
    h.update(enc('12345')).update(enc('678'));
    expect(h.bytes).toBe(8);
  });

  it('refuses to keep hashing after the digest is taken', () => {
    const h = new Sha256();
    h.update(enc('done'));
    h.hex();
    expect(() => h.update(enc('more'))).toThrow();
  });
});
