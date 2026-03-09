// Base62 encoding + deflate compression utilities

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function encodeBase62(num: number): string {
  if (num === 0) return '0';
  let result = '';
  let n = num;
  while (n > 0) {
    result = BASE62[n % 62] + result;
    n = Math.floor(n / 62);
  }
  return result;
}

export function decodeBase62(str: string): number {
  let result = 0;
  for (const char of str) {
    result = result * 62 + BASE62.indexOf(char);
  }
  return result;
}

// TODO: Implement deflate compression/decompression
