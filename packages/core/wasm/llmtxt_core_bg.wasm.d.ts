/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const calculate_tokens: (a: number, b: number) => number;
export const compress: (a: number, b: number) => [number, number, number, number];
export const compute_signature: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
export const compute_signature_with_length: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
export const decode_base62: (a: number, b: number) => bigint;
export const decompress: (a: number, b: number) => [number, number, number, number];
export const derive_signing_key: (a: number, b: number) => [number, number];
export const encode_base62: (a: bigint) => [number, number];
export const generate_id: () => [number, number];
export const hash_content: (a: number, b: number) => [number, number];
export const is_expired: (a: number) => number;
export const calculate_compression_ratio: (a: number, b: number) => number;
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
