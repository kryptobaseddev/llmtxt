/**
 * @packageDocumentation
 * Primitives and SDK for LLM agent content workflows.
 * Compression, validation, progressive disclosure, signed URLs, caching,
 * collaborative document lifecycle, versioning, and retrieval planning.
 * Provider-agnostic. Only external dependency: zod.
 */
export { encodeBase62, decodeBase62, compress, decompress, generateId, hashContent, hashBlob, calculateTokens, calculateCompressionRatio, computeDiff, structuredDiff, } from './compression.js';
export type { DiffResult, StructuredDiffLine, StructuredDiffResult } from './compression.js';
export { validateJson, validateText, validateContent, autoValidate, DEFAULT_MAX_CONTENT_BYTES, DEFAULT_MAX_LINE_BYTES, } from './validation.js';
export type { ValidationResult, ValidationError, ValidateContentOptions, } from './validation.js';
export { jsonFormatSchema, textFormatSchema, markdownFormatSchema, promptMessageSchema, promptV1Schema, predefinedSchemas, isPredefinedSchema, getPredefinedSchema, compressRequestSchema, decompressRequestSchema, searchRequestSchema, } from './schemas.js';
export type { PredefinedSchemaName, JsonFormat, TextFormat, MarkdownFormat, PromptV1, PromptMessage, CompressRequest, DecompressRequest, SearchRequest, } from './schemas.js';
export { getLineRange, searchContent, detectDocumentFormat, generateOverview, queryJsonPath, getSection, } from './disclosure.js';
export type { Section, DocumentOverview, SearchResult, LineRangeResult, } from './disclosure.js';
export { LRUCache } from './cache.js';
export type { CacheStats, LRUCacheOptions, } from './cache.js';
export { computeSignature, computeSignatureWithLength, computeOrgSignature, computeOrgSignatureWithLength, generateSignedUrl, generateOrgSignedUrl, verifySignedUrl, verifyOrgSignedUrl, generateTimedUrl, deriveSigningKey, isExpired, } from './signed-url.js';
export type { SignedUrlParams, OrgSignedUrlParams, SignedUrlConfig, VerifyResult, } from './signed-url.js';
export { createPatch, applyPatch, reconstructVersion, squashPatchesWasm } from './patch.js';
export { multiWayDiff, cherryPickMerge, threeWayMerge } from './patch.js';
export type { MultiDiffVariant, MultiDiffLine, MultiDiffStats, MultiDiffResult, CherryPickProvenance, CherryPickStats, CherryPickResult, Conflict, MergeStats, ThreeWayMergeResult, } from './patch.js';
export { roleHasPermission, rolePermissions } from './wasm.js';
export { ROLE_PERMISSIONS } from './types.js';
export type { DocumentRole, OrgRole, Permission } from './types.js';
export { STATE_CHANGING_METHODS } from './types.js';
export type { AuditAction } from './types.js';
export { CONTENT_LIMITS } from './types.js';
export { API_VERSION_REGISTRY, CURRENT_API_VERSION, LATEST_API_VERSION, } from './types.js';
export type { ApiVersionInfo } from './types.js';
export { VALID_LINK_TYPES } from './types.js';
export type { LinkType } from './types.js';
export { COLLECTION_EXPORT_SEPARATOR } from './types.js';
export { API_KEY_PREFIX, API_KEY_LENGTH, API_KEY_DISPLAY_LENGTH, } from './types.js';
export { slugify } from './wasm.js';
export { l2Normalize } from './wasm.js';
export { signWebhookPayload } from './wasm.js';
export { constantTimeEqHex, verifyContentHash } from './wasm.js';
export { cosineSimilarity } from './wasm.js';
export { semanticDiff, semanticConsensus } from './wasm.js';
export type { SectionAlignment, SectionSimilarity, SemanticChange, SemanticDiffResult, ReviewCluster, SemanticConsensusResult, } from './wasm.js';
export { compressSnapshot, decompressSnapshot, compressSessionData, decompressSessionData, snapshotSummary, } from './snapshot.js';
export type { SnapshotMeta, CompressedSnapshot, SnapshotOptions, } from './snapshot.js';
export { createClient } from './client.js';
export type { LlmtxtClientConfig, UploadResult, FetchResult, ReshareResult, ResignResult, AttachmentVersionResult, } from './client.js';
export { contentSimilarity, extractNgrams, extractWordShingles, fingerprintSimilarity, jaccardSimilarity, minHashFingerprint, rankBySimilarity, textSimilarity, } from './similarity.js';
export type { SimilarityRankResult } from './wasm.js';
export { buildGraph, extractDirectives, extractMentions, extractTags, topAgents, topTopics, } from './graph.js';
export type { GraphEdge, GraphNode, GraphStats, KnowledgeGraph, MessageInput, } from './graph.js';
export { containsBinaryContent, detectFormat, findOverlongLine, } from './wasm.js';
export { fnv1aHash, tfidfEmbed, tfidfEmbedBatch } from './wasm.js';
export type { ContentFormat, DocumentEvent, DocumentEventType, DocumentMeta, VersionMeta, VersionSummary, VersionDiff, LlmtxtRef, AttachmentOptions, AttachmentAccessMode, AttachmentSharingMode, AttachmentReshareOptions, AttachmentVersionOptions, } from './types.js';
export { watchDocument } from './watch.js';
export type { DocumentEventLogEntry, WatchDocumentOptions } from './watch.js';
export type { StorageAdapter } from './sdk/storage-adapter.js';
export type { LlmtxtDocumentOptions, CreateVersionOptions } from './sdk/document.js';
export { LlmtxtDocument } from './sdk/document.js';
export type { DocumentState, StateTransition, TransitionResult, } from './sdk/lifecycle.js';
export type { VersionEntry, ReconstructionResult, PatchValidationResult, VersionDiffSummary, } from './sdk/versions.js';
export type { ApprovalStatus, Review, ApprovalPolicy, ApprovalResult, } from './sdk/consensus.js';
export type { VersionAttribution, ContributorSummary, } from './sdk/attribution.js';
export type { StorageType, CompressionMethod, ContentRef, StorageMetadata, } from './sdk/storage.js';
export type { PlannedSection, RetrievalPlan, RetrievalOptions, } from './sdk/retrieval.js';
export { AgentIdentity, bodyHashHex, buildCanonicalPayload, randomNonceHex } from './identity.js';
export type { SignatureHeaders, CanonicalPayloadOptions } from './identity.js';
export { subscribeSection, getSectionText } from './crdt.js';
export type { SectionDelta, Unsubscribe, SubscribeSectionOptions } from './crdt.js';
export { setLocalAwarenessState, onAwarenessChange, getAwarenessStates } from './awareness.js';
export type { AwarenessState, AwarenessEvent, AwarenessEventType } from './awareness.js';
export { LeaseManager, LeaseConflictError } from './leases.js';
export type { Lease, LeaseOptions } from './leases.js';
export { subscribe, fetchSectionDelta } from './subscriptions.js';
export type { SubscribeOptions, SubscriptionEvent, SectionDeltaResponse } from './subscriptions.js';
export { TopologyConfigError, validateTopologyConfig, standaloneConfigSchema, hubSpokeConfigSchema, meshConfigSchema, topologyConfigSchema, } from './topology.js';
export type { TopologyMode, TopologyConfig, StandaloneConfig, HubSpokeConfig, MeshConfig, } from './topology.js';
export { createBackend, HubSpokeBackend, MeshBackend, MeshNotImplementedError, HubUnreachableError, HubWriteQueueFullError, } from './backend/factory.js';
export { MeshBackend as MeshBackendStub } from './mesh/index.js';
export { formatMarkdown, formatJson, formatTxt, formatLlmtxt, } from './export/index.js';
export type { DocumentExportState, ExportOpts } from './export/index.js';
//# sourceMappingURL=index.d.ts.map