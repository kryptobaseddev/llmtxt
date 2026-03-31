export type DocumentState = 'DRAFT' | 'REVIEW' | 'LOCKED' | 'ARCHIVED';
export type DocumentFormat = 'json' | 'markdown' | 'text' | 'code';

export interface Document {
  id: string;
  slug: string;
  format: DocumentFormat;
  content?: string;
  contentHash: string;
  originalSize: number;
  compressedSize: number;
  tokenCount: number;
  compressionRatio: number;
  createdAt: number;
  expiresAt?: number;
  accessCount: number;
  lastAccessedAt?: number;
  state?: DocumentState;
  currentVersion?: number;
  versionCount?: number;
  ownerId?: string;
}

export interface CreateDocumentResponse {
  id: string;
  slug: string;
  url: string;
  format: DocumentFormat;
  tokenCount: number;
  compressionRatio: number;
  originalSize: number;
  compressedSize: number;
  schema?: string;
  validated?: boolean;
}

export interface OverviewSection {
  title: string;
  depth: number;
  startLine: number;
  endLine: number;
  tokenCount: number;
  type: string;
}

export interface DocumentOverview {
  slug: string;
  format: DocumentFormat;
  lineCount: number;
  tokenCount: number;
  sections: OverviewSection[];
  keys?: Array<{ key: string; type: string; preview: string }>;
  toc?: Array<{ title: string; depth: number; line: number }>;
}

export interface Version {
  versionNumber: number;
  contentHash: string;
  tokenCount: number;
  createdAt: number;
  createdBy: string | null;
  changelog: string | null;
}

export interface VersionList {
  slug: string;
  totalVersions: number;
  versions: Version[];
}

export interface DiffResult {
  documentId: string;
  slug: string;
  fromVersion: number;
  toVersion: number;
  addedLines: string[];
  removedLines: string[];
  addedLineCount: number;
  removedLineCount: number;
  addedTokens: number;
  removedTokens: number;
  patchText: string;
}

export interface Review {
  id: string;
  reviewerId: string;
  status: 'APPROVED' | 'REJECTED';
  timestamp: number;
  reason: string | null;
  atVersion: number;
}

export interface Consensus {
  approved: boolean;
  approvedBy: string[];
  rejectedBy: string[];
  pendingFrom: string[];
  staleFrom: string[];
  reason: string;
}

export interface ApprovalsResponse {
  slug: string;
  state: DocumentState;
  reviews: Review[];
  consensus: Consensus;
}

export interface Contributor {
  id: string;
  userId: string;
  documentId: string;
  addedTokens: number;
  removedTokens: number;
  netTokens: number;
  patchCount: number;
  firstContributedAt: number;
  lastContributedAt: number;
}

export interface ContributorsResponse {
  slug: string;
  totalContributors: number;
  contributors: Contributor[];
}

export interface Session {
  user: {
    id: string;
    email?: string;
    name?: string;
    isAnonymous?: boolean;
  } | null;
}
