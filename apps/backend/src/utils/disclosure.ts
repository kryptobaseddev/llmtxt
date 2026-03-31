/** Re-export progressive disclosure utilities from the llmtxt SDK: section extraction, content search, format detection, and structural overview generation. */
export {
  getLineRange,
  searchContent,
  detectDocumentFormat,
  generateOverview,
  queryJsonPath,
  getSection,
} from 'llmtxt';

export type {
  Section,
  DocumentOverview,
  SearchResult,
  LineRangeResult,
} from 'llmtxt';
