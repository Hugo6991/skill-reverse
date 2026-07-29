import { z } from "zod";

const publicHttpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith("https://"), "Only public HTTPS URLs are supported");

const creatorKindSchema = z.enum(["person", "organization", "team", "unknown"]);
const shortText = z.string().min(1).max(500);
const evidenceUrls = z.array(z.string().url()).max(4);

export const createJobSchema = z.object({
  targetUrl: publicHttpsUrl,
  supportUrls: z.array(publicHttpsUrl).max(8).optional().default([]),
  occupationCode: z.string().regex(/^\d{2}-\d{4}\.\d{2}$/),
  turnstileToken: z.string().min(1).max(2048)
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

export const updateJobSourcesSchema = z.object({
  urls: z.array(publicHttpsUrl).max(8),
  finalize: z.boolean().default(false)
});

export const retryJobSchema = z.object({
  turnstileToken: z.string().min(1).max(2048)
});

export const researchDraftSchema = z.object({
  researchSummary: z.string().min(1).max(800),
  frameworkHypothesis: z.object({
    name: z.string().min(1).max(100),
    summary: z.string().min(1).max(500),
    useWhen: z.string().min(1).max(500),
    avoidWhen: z.string().min(1).max(500),
    steps: z
      .array(
        z.object({
          title: z.string().min(1).max(80),
          instruction: z.string().min(1).max(400),
          failureType: z.enum(["discipline", "shape", "omission", "conditional"])
        })
      )
      .min(2)
      .max(5)
  }),
  authorContext: z.object({
    kind: creatorKindSchema.optional(),
    name: z.string().max(160),
    handle: z.string().max(15).optional(),
    background: z.string().max(600),
    context: z.string().max(600)
  }),
  observations: z
    .array(
      z.object({
        text: shortText,
        sourceUrls: evidenceUrls.min(1)
      })
    )
    .max(6),
  candidateClaims: z
    .array(
      z.object({
        text: shortText,
        confidence: z.enum(["high", "medium", "low"]),
        evidenceUrls
      })
    )
    .max(6),
  professionalSignals: z
    .array(
      z.object({
        competencyLabel: z.string().min(1).max(160),
        manifestation: z.enum([
          "evidenced",
          "author_specific_extension",
          "missing_but_expected",
          "not_observable",
          "contradicted"
        ]),
        rationale: shortText,
        evidenceUrls
      })
    )
    .max(8),
  adoptionIdeas: z.array(z.string().min(1).max(400)).max(6),
  caveats: z.array(z.string().min(1).max(400)).max(6)
});

export type ResearchDraft = z.infer<typeof researchDraftSchema>;

const identityCandidateSchema = z.object({
  // Keep runtime parsing structural: semantic errors discard only this candidate later.
  title: z.string().min(1).max(80),
  oneLiner: z.string().min(1).max(200),
  traits: z.tuple([
    z.string().min(1).max(100),
    z.string().min(1).max(100),
    z.string().min(1).max(100)
  ]),
  evidenceUrls: z.array(z.string().min(1).max(2_048)).max(6)
});

export const modelResultSchema = z.object({
  title: z.string().min(1).max(160),
  verdict: z.string().min(1).max(800),
  framework: z.object({
    name: z.string().min(1).max(100),
    summary: z.string().min(1).max(500),
    useWhen: z.string().min(1).max(500),
    avoidWhen: z.string().min(1).max(500),
    steps: z
      .array(
        z.object({
          title: z.string().min(1).max(80),
          instruction: z.string().min(1).max(400),
          failureType: z.enum(["discipline", "shape", "omission", "conditional"])
        })
      )
      .min(2)
      .max(5)
  }),
  author: z.object({
    kind: creatorKindSchema.optional(),
    name: z.string().max(160),
    handle: z.string().max(15).optional(),
    background: z.string().max(600),
    context: z.string().max(600)
  }),
  observations: z
    .array(
      z.object({
        text: shortText,
        sourceUrls: evidenceUrls.min(1)
      })
    )
    .max(6),
  claims: z
    .array(
      z.object({
        text: shortText,
        status: z.enum([
          "verified",
          "supported_inference",
          "plausible",
          "unknown_contradicted"
        ]),
        confidence: z.number().min(0).max(100),
        evidenceUrls,
        score: z.object({
          directness: z.number().min(0).max(30),
          firstParty: z.number().min(0).max(20),
          corroboration: z.number().min(0).max(20),
          temporalFit: z.number().min(0).max(15),
          reproducibility: z.number().min(0).max(15),
          contradictionPenalty: z.number().min(-30).max(0)
        })
      })
    )
    .max(6),
  professionalDelta: z
    .array(
      z.object({
        competencyLabel: z.string().min(1).max(160),
        manifestation: z.enum([
          "evidenced",
          "author_specific_extension",
          "missing_but_expected",
          "not_observable",
          "contradicted"
        ]),
        rationale: shortText,
        evidenceUrls
      })
    )
    .max(8),
  identityCandidates: z.array(identityCandidateSchema).length(3),
  adoption: z.array(z.string().min(1).max(400)).max(6),
  caveats: z.array(z.string().min(1).max(400)).max(6)
});

export type ModelResult = z.infer<typeof modelResultSchema>;

export const reportTranslationSchema = z.object({
  title: z.string().min(1),
  verdict: z.string().min(1),
  framework: z.object({
    name: z.string().min(1),
    summary: z.string().min(1),
    useWhen: z.string().min(1),
    avoidWhen: z.string().min(1),
    steps: z.array(
      z.object({
        title: z.string().min(1),
        instruction: z.string().min(1)
      })
    )
  }),
  author: z.object({
    background: z.string().min(1),
    context: z.string().min(1)
  }),
  gameIdentity: z.object({
    title: z.string().min(1),
    oneLiner: z.string().min(1),
    traits: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)])
  }),
  occupation: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    competencyLabels: z.array(z.string().min(1))
  }),
  observations: z.array(z.string().min(1)),
  claims: z.array(z.string().min(1)),
  professionalDelta: z.array(z.string().min(1)),
  adoption: z.array(z.string().min(1)),
  caveats: z.array(z.string().min(1)),
  degraded: z.array(z.string().min(1))
});

export type ReportTranslation = z.infer<typeof reportTranslationSchema>;
