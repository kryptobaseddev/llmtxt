# Changelog

All notable changes to `@codluv/llmtxt` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **client**: attachment helpers for conversation-scoped reads, owner reads, and signed URL re-signing
- **types**: `AttachmentAccessMode` export for bridge/API integrations

### Changed

- **signed-url**: support configurable path prefixes and signature lengths when generating URLs
- **signed-url**: verify URLs using the actual signature length and final path segment so `/attachments/{slug}` URLs verify correctly

## [0.4.0] - 2026-03-23

### Added

- **compression**: deflate compress/decompress, base62 encoding/decoding, SHA-256 hashing, token estimation, compression ratio calculation
- **schemas**: Zod validation schemas for JSON/text/markdown formats, `prompt-v1` predefined schema, schema registry with type exports
- **validation**: format auto-detection, content validation against schemas, `autoValidate` convenience function
- **disclosure**: progressive disclosure utilities — document overview generation, section extraction, line-range access, content search (string + regex), JSONPath queries, TOC generation
- **cache**: generic LRU cache with configurable TTL, max size, and hit/miss statistics
- **signed-url**: HMAC-SHA256 signed URL generation and verification — conversation-scoped, time-limited, with timing-safe comparison

[Unreleased]: https://github.com/kryptobaseddev/llmtxt/compare/core-v0.4.0...HEAD
[0.4.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/core-v0.4.0
