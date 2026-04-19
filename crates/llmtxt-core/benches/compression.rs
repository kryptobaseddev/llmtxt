//! Compression benchmark: zlib vs zstd on representative LLMtxt corpus.
//!
//! Run with:
//!   cargo bench --bench compression
//!
//! The corpus is the project README and a synthetic markdown document that
//! resembles real llmtxt content (headings, paragraphs, JSON snippets).
//!
//! Results are written to `target/criterion/` as HTML reports.
//!
//! T755 — Benchmark zlib vs zstd compression ratio and encode/decode speed.

use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use llmtxt_core::{zlib_compress, zstd_compress, zstd_decompress};
use std::io::Read;

// ── Corpus ───────────────────────────────────────────────────────────────────

/// A representative corpus of llmtxt content: markdown docs, JSON, prose.
/// Includes the project README content (embedded at compile time) plus
/// synthetic paragraphs to reach a meaningful size for benchmarking.
fn build_corpus() -> Vec<(&'static str, Vec<u8>)> {
    let readme = include_str!("../../../README.md");

    // Synthetic markdown document simulating a real llmtxt document
    let synthetic_md = "# LLMtxt Agent Coordination Protocol\n\n\
        ## Overview\n\n\
        This document describes the multi-agent coordination protocol used \
        by the llmtxt platform. Agents coordinate via signed Ed25519 envelopes \
        routed through the A2A message layer.\n\n\
        ## Authentication\n\n\
        Every agent must present a valid Ed25519 public key during the handshake \
        phase. The key is verified against the agent registry before any document \
        operations are permitted.\n\n\
        ## Compression Format\n\n\
        Documents stored on the platform are compressed using zstd (RFC 8478). \
        Legacy documents compressed with zlib (RFC 1950) continue to be readable \
        via magic-byte detection in the decompression layer.\n\n\
        ```json\n\
        {\n  \"slug\": \"agent-protocol-v2\",\n  \"format\": \"markdown\",\n\
        \"compressionCodec\": \"zstd\",\n  \"originalSize\": 4096,\n\
        \"compressedSize\": 1024,\n  \"compressionRatio\": 4.0\n}\n\
        ```\n\n\
        ## Version History\n\n\
        | Version | Date       | Changes                          |\n\
        |---------|------------|----------------------------------|\n\
        | v2026.4 | 2026-04-17 | Storage Evolution + zstd          |\n\
        | v2026.3 | 2026-04-11 | Multi-agent foundation            |\n\
        | v2026.2 | 2026-03-15 | CRDT Loro integration             |\n\n\
        ## Notes\n\n\
        The platform targets < 200 ms p99 for compress + store operations. \
        zstd level 3 provides 1.3-1.5x better ratio vs zlib at comparable CPU \
        cost on text payloads.\n"
        .repeat(8); // ~8 KB of real-world-like markdown

    // Repetitive prose (tests compression ratio limits)
    let repetitive = "the quick brown fox jumps over the lazy dog. \
        lorem ipsum dolor sit amet consectetur adipiscing elit. "
        .repeat(400);

    vec![
        ("readme", readme.as_bytes().to_vec()),
        ("synthetic_md_8kb", synthetic_md.as_bytes().to_vec()),
        ("repetitive_prose_30kb", repetitive.as_bytes().to_vec()),
    ]
}

// ── Encode benchmarks ────────────────────────────────────────────────────────

fn bench_zlib_encode(c: &mut Criterion) {
    let corpus = build_corpus();
    let mut group = c.benchmark_group("encode/zlib");
    for (name, data) in &corpus {
        group.throughput(Throughput::Bytes(data.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(name), data, |b, d| {
            b.iter(|| zlib_compress(d).expect("zlib compress"));
        });
    }
    group.finish();
}

fn bench_zstd_encode(c: &mut Criterion) {
    let corpus = build_corpus();
    let mut group = c.benchmark_group("encode/zstd");
    for (name, data) in &corpus {
        group.throughput(Throughput::Bytes(data.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(name), data, |b, d| {
            b.iter(|| zstd_compress(d).expect("zstd compress"));
        });
    }
    group.finish();
}

// ── Decode benchmarks ────────────────────────────────────────────────────────

fn bench_zstd_decode(c: &mut Criterion) {
    let corpus = build_corpus();
    let mut group = c.benchmark_group("decode/zstd");
    for (name, data) in &corpus {
        let compressed = zstd_compress(data).expect("zstd compress for decode bench");
        group.throughput(Throughput::Bytes(data.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(name), &compressed, |b, d| {
            b.iter(|| zstd_decompress(d).expect("zstd decompress"));
        });
    }
    group.finish();
}

fn bench_zlib_decode(c: &mut Criterion) {
    let corpus = build_corpus();
    let mut group = c.benchmark_group("decode/zlib");
    for (name, data) in &corpus {
        let compressed = zlib_compress(data).expect("zlib compress for decode bench");
        group.throughput(Throughput::Bytes(data.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(name), &compressed, |b, d| {
            b.iter(|| {
                use flate2::read::ZlibDecoder;
                let mut decoder = ZlibDecoder::new(d.as_slice());
                let mut out = Vec::new();
                decoder.read_to_end(&mut out).expect("zlib decode");
                out
            });
        });
    }
    group.finish();
}

// ── Ratio report (runs once, prints a table) ────────────────────────────────

fn bench_compression_ratio(c: &mut Criterion) {
    let corpus = build_corpus();
    let mut group = c.benchmark_group("ratio_report");
    for (name, data) in &corpus {
        let zlib_out = zlib_compress(data).expect("zlib");
        let zstd_out = zstd_compress(data).expect("zstd");
        let zlib_ratio = data.len() as f64 / zlib_out.len() as f64;
        let zstd_ratio = data.len() as f64 / zstd_out.len() as f64;
        println!(
            "[ratio] {name}: original={orig}B  zlib={zlib}B ({zlib_r:.2}x)  zstd={zstd}B ({zstd_r:.2}x)  improvement={imp:.2}x",
            orig = data.len(),
            zlib = zlib_out.len(),
            zlib_r = zlib_ratio,
            zstd = zstd_out.len(),
            zstd_r = zstd_ratio,
            imp = zstd_ratio / zlib_ratio,
        );
        // Dummy bench so criterion includes this group
        group.bench_with_input(BenchmarkId::from_parameter(name), data, |b, d| {
            b.iter(|| zstd_compress(d).expect("zstd"));
        });
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_zlib_encode,
    bench_zstd_encode,
    bench_zstd_decode,
    bench_zlib_decode,
    bench_compression_ratio,
);
criterion_main!(benches);
