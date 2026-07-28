export type JobStage =
  | "validate"
  | "occupation_confirmation"
  | "capture"
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
  reportId?: string;
  degraded: string[];
  costUsd: number;
  error?: {
    code: string;
    message: string;
  };
}

export interface PublicConfig {
  mode: "locked" | "demo" | "public";
  turnstileSiteKey: string;
  socialEnabled: boolean;
  limits: {
    jobsPerDay: number;
    maxUrls: number;
    maxJobUsd: number;
  };
}
