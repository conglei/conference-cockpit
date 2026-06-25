/**
 * The pluggable company-source layer (issue 11). A `CompanySource` fetches +
 * normalizes a batch of fresh companies; the mechanical `refresh` pipeline
 * dedupes, inserts, and resolves them with no LLM. Adding a source is just a new
 * adapter of the {@link CompanySource} seam.
 */
export type { CompanySource, SourcedCompany } from "./types";
export {
  StartupsGallerySource,
  fakeStartupsGallerySource,
  type StartupsGalleryRecord,
  type StartupsGalleryFetcher,
  type StartupsGalleryOptions,
} from "./startups-gallery";
export { CsvSource, type CsvSourceOptions } from "./csv-source";
export {
  refresh,
  newCompaniesSince,
  type RefreshDeps,
  type RefreshOptions,
  type RefreshResult,
  type SourceRefreshResult,
} from "./refresh";
