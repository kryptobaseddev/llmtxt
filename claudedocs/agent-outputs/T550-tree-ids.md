# T550 Tree — Actual CLEO ID Mapping

Generated: 2026-04-18

## Epic

T550 (label) = T606 (actual)

## Large Tasks (children of T606)

T551 (Extract llmtxt/blob) = T607
T552 (Extract llmtxt/events) = T608
T553 (Extract llmtxt/identity) = T609
T554 (Extract llmtxt/transport) = T610
T555 (Harden /sdk /crdt /similarity) = T611
T556 (STABILITY.md + CI guard + deprecation) = T612
T557 (README + CHANGELOG + Fumadocs + CLEO guide) = T615
T558 (Release v2026.4.9) = T616

## T551 Subtasks (children of T607)

T551.1 (Audit blob code locations) = T621
T551.2 (Move blob code to subpath) = T622
T551.3 (Contract tests for blob) = T623
T551.4 (Refactor /local to delegate to /blob) = T625
T551.5 (Fumadocs blob.mdx) = T626

## T552 Subtasks (children of T608)

T552.1 (Audit events code locations) = T627
T552.2 (Design events subpath API) = T628
T552.3 (Implement events subpath) = T629
T552.4 (Contract tests for events) = T632
T552.5 (Refactor LocalBackend events) = T633
T552.6 (Refactor PostgresBackend events) = T634
T552.7 (Regression — events refactor) = T637
T552.8 (Fumadocs events.mdx) = T638

## T553 Subtasks (children of T609)

T553.1 (Audit identity code locations) = T642
T553.2 (Design identity subpath API) = T645
T553.3 (Implement identity subpath) = T647
T553.4 (Refactor AgentSession to /identity) = T650
T553.5 (Refactor identity middleware to /identity) = T651
T553.6 (Contract tests for identity) = T652
T553.7 (Fumadocs identity.mdx) = T653

## T554 Subtasks (children of T610)

T554.1 (Audit transport code locations) = T657
T554.2 (Design transport subpath API) = T659
T554.3 (Implement transport subpath) = T660
T554.4 (Refactor mesh module to /transport) = T662
T554.5 (Contract tests for transport) = T663
T554.6 (Fumadocs transport.mdx) = T664

## T555 Subtasks (children of T611)

T555.1 (Contract tests for /sdk) = T665
T555.2 (Contract tests for /crdt) = T666
T555.3 (Contract tests for /similarity) = T667
T555.4 (Regression — contract additions) = T668
T555.5 (Fumadocs pages for sdk/crdt/similarity) = T669

## T556 Subtasks (children of T612)

T556.1 (STABILITY.md file) = T670
T556.2 (CI guard for breaking changes) = T671
T556.3 (Deprecation policy doc) = T672
T556.4 (tsc --declaration snapshots) = T673
T556.5 (docs/architecture/subpath-contract.md) = T674

## T557 Subtasks (children of T615)

T557.1 (README primitives table) = T675
T557.2 (packages/llmtxt/CHANGELOG.md entry) = T676
T557.3 (Root CHANGELOG.md entry) = T677
T557.4 (Fumadocs primitives landing page) = T678
T557.5 (CLEO migration guide) = T679

## T558 Subtasks (children of T616)

T558.1 (Version bump to 2026.4.9) = T680
T558.2 (Git tags) = T681
T558.3 (Push tags / npm publish) = T682
T558.4 (Verify npm provenance) = T683
T558.5 (crates.io publish via OIDC) = T684
T558.6 (CLEO #96 handoff note) = T685

## Summary

Total tasks created: 56
  - 1 epic (T606)
  - 8 large tasks (T607–T616)
  - 47 atomic subtasks (T621–T685)

Orchestration: initialized via `cleo orchestrate start T606`
Wave 1 ready: T607, T608, T609, T610, T611, T612, T615, T616 (all 8 large tasks)
