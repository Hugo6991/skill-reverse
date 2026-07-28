export type JobStage =
  | "validate"
  | "occupation_confirmation"
  | "capture"
  | "source_collection"
  | "research"
  | "source_verification"
  | "professional_baseline"
  | "hypothesis_generation"
  | "report";

export type EvidenceStatus =
  | "verified"
  | "supported_inference"
  | "plausible"
  | "unknown_contradicted";

export type DeltaManifestation =
  | "evidenced"
  | "author_specific_extension"
  | "missing_but_expected"
  | "not_observable"
  | "contradicted";

export interface CompetencyPoint {
  kind: "task" | "knowledge" | "skill" | "technology";
  label: string;
  importance: number;
  sourceUri: string;
}

export interface OccupationProfile {
  code: string;
  title: string;
  description: string;
  provider: "O*NET";
  version: string;
  sourceUri: string;
  aliases: string[];
  competencies: CompetencyPoint[];
}

export interface SourceArtifact {
  id: string;
  url: string;
  kind: "website" | "github" | "article" | "x_post" | "document";
  status: "verified_at_retrieval" | "inherited" | "unverified";
  title: string;
  retrievedAt: string;
  excerpt?: string;
  archive?: ArchivedArtifact;
  repositoryMetrics?: RepositoryMetrics;
}

export interface ArchivedArtifact {
  snapshotUrl: string;
  screenshotUrl?: string;
}

export interface RepositoryMetrics {
  provider: "github";
  fullName: string;
  ownerType: "Organization" | "User" | "Unknown";
  stars: number;
  forks: number;
  watchers: number;
  pushedAt?: string;
  retrievedAt: string;
}

export interface Observation {
  id: string;
  text: string;
  sourceIds: string[];
}

export interface Claim {
  id: string;
  text: string;
  status: EvidenceStatus;
  confidence: number;
  evidenceIds: string[];
  score: {
    directness: number;
    firstParty: number;
    corroboration: number;
    temporalFit: number;
    reproducibility: number;
    contradictionPenalty: number;
  };
}

export interface EvidenceEdge {
  id: string;
  source: string;
  target: string;
  relation: "supports" | "contradicts" | "derived_from" | "baseline_for";
}

export interface ProfessionalDelta {
  competency: CompetencyPoint;
  manifestation: DeltaManifestation;
  rationale: string;
  evidenceIds: string[];
}

export interface FrameworkStep {
  title: string;
  instruction: string;
  failureType: "discipline" | "shape" | "omission" | "conditional";
}

export type GameAxisId =
  | "money"
  | "spectacle"
  | "potency"
  | "activation"
  | "renown"
  | "ascension";

export type GameArchetypeId =
  | "wealth_with_proof"
  | "all_aura"
  | "quiet_power"
  | "hard_ascension"
  | "famous_sect"
  | "hidden_manual"
  | "instant_magic"
  | "money"
  | "spectacle"
  | "potency"
  | "activation"
  | "renown"
  | "ascension";

export type GameRoastId =
  | "all_aura"
  | "famous_but_unproven"
  | "expensive_unknown_return"
  | "valuable_hard_start"
  | "quiet_power"
  | "portable_manual"
  | "balanced";

export type GameBadgeId =
  | "evidence_rich"
  | "low_dependency"
  | "portable"
  | "field_tested"
  | "well_maintained";

export interface GameAxis {
  id: GameAxisId;
  value?: number;
  coverage: number;
  evidenceIds: string[];
  signalIds: string[];
  signalDetails?: GameAxisSignal[];
}

export interface GameAxisSignal {
  id: string;
  value?: number;
  points: number;
  maxPoints: number;
  evidenceIds: string[];
}

export interface GameProfile {
  rubricVersion: "game-profile-v1" | "game-profile-v1.1";
  axes: GameAxis[];
  archetypeId: GameArchetypeId;
  roastId: GameRoastId;
  badges: GameBadgeId[];
  strongestAxisId: GameAxisId;
  weakestAxisId: GameAxisId;
  author: {
    avatarUrl?: string;
    profileUrl?: string;
    attribution: "repository_owner" | "identified_creator" | "source_creator";
  };
}

export interface ReverseReport {
  id: string;
  title: string;
  targetUrl: string;
  generatedAt: string;
  verdict: string;
  framework: {
    name: string;
    summary: string;
    useWhen: string;
    avoidWhen: string;
    steps: FrameworkStep[];
  };
  author: {
    name: string;
    handle?: string;
    background: string;
    context: string;
  };
  gameProfile: GameProfile;
  occupation: OccupationProfile;
  professionalDelta: ProfessionalDelta[];
  observations: Observation[];
  claims: Claim[];
  sources: SourceArtifact[];
  edges: EvidenceEdge[];
  adoption: string[];
  caveats: string[];
  degraded: string[];
}

export interface JobStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: JobStage;
  progress: number;
  targetUrl?: string;
  occupationCode?: string;
  createdAt?: string;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  queuePosition?: number;
  reportId?: string;
  degraded: string[];
  costUsd: number;
  sourceCollection?: {
    open: boolean;
    closesAt?: string;
    submittedCount: number;
  };
  error?: {
    code: string;
    message: string;
  };
  retry?: {
    allowed: boolean;
    count: number;
    max: number;
    automaticCount?: number;
    automaticMax?: number;
  };
}

export type PublicationStatus = "unpublished" | "published" | "hidden";

export interface PublicHistoryItem {
  jobId: string;
  targetUrl: string;
  displayName: string;
  sourceHost: string;
  skillLabels: string[];
  occupationCode: string;
  occupationTitle: string;
  status: "completed";
  stage: "report";
  progress: 100;
  reportId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
}

export type HistoryItem = PublicHistoryItem;

export interface HistoryPage {
  items: PublicHistoryItem[];
  nextCursor?: string;
}

export interface MyResearchItem {
  jobId: string;
  targetUrl: string;
  occupationCode: string;
  occupationTitle: string;
  status: "queued" | "running" | "failed";
  stage: JobStage;
  progress: number;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  queuePosition?: number;
  autoRetryCount: number;
  updatedAt: string;
}

export interface MyResearchPage {
  items: MyResearchItem[];
}

export interface AdminReportItem {
  reportId: string;
  jobId: string;
  title: string;
  targetUrl: string;
  publicationStatus: Extract<PublicationStatus, "published" | "hidden">;
  publishedAt: string | null;
  hiddenAt: string | null;
  moderationNote: string | null;
  occupationTitle: string | null;
}

export interface SkillCardSummary {
  id: string;
  reportId?: string;
  targetUrl: string;
  displayName: string;
  occupationCode: string;
  occupationTitle: string;
  gameProfile: GameProfile;
  createdAt: string;
  updatedAt: string;
  shareSlug?: string;
}

export interface CollectionPage {
  cards: SkillCardSummary[];
  activity: MyResearchItem[];
  nextCursor?: string;
}

export interface PublicSkillCard {
  id: string;
  targetUrl: string;
  displayName: string;
  occupationTitle: string;
  gameProfile: GameProfile;
  createdAt: string;
}

export interface PublicConfig {
  mode: "locked" | "demo" | "public";
  turnstileSiteKey: string;
}
