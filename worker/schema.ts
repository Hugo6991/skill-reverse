import { z } from "zod";

const publicHttpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith("https://"), "Only public HTTPS URLs are supported");

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
  researchSummary: z.string().min(1),
  frameworkHypothesis: z.object({
    name: z.string().min(1),
    summary: z.string().min(1),
    useWhen: z.string().min(1),
    avoidWhen: z.string().min(1),
    steps: z
      .array(
        z.object({
          title: z.string().min(1),
          instruction: z.string().min(1),
          failureType: z.enum(["discipline", "shape", "omission", "conditional"])
        })
      )
      .min(2)
      .max(6)
  }),
  authorContext: z.object({
    name: z.string(),
    handle: z.string().optional(),
    background: z.string(),
    context: z.string()
  }),
  observations: z.array(
    z.object({
      text: z.string().min(1),
      sourceUrls: z.array(z.string().url()).min(1)
    })
  ),
  candidateClaims: z.array(
    z.object({
      text: z.string().min(1),
      confidence: z.enum(["high", "medium", "low"]),
      evidenceUrls: z.array(z.string().url())
    })
  ),
  professionalSignals: z.array(
    z.object({
      competencyLabel: z.string().min(1),
      manifestation: z.enum([
        "evidenced",
        "author_specific_extension",
        "missing_but_expected",
        "not_observable",
        "contradicted"
      ]),
      rationale: z.string().min(1),
      evidenceUrls: z.array(z.string().url())
    })
  ),
  adoptionIdeas: z.array(z.string()).max(8),
  caveats: z.array(z.string()).max(8)
});

export type ResearchDraft = z.infer<typeof researchDraftSchema>;

const identityCandidateSchema = z.object({
  title: z
    .string()
    .min(4)
    .max(10)
    .refine((value) => /[\u3400-\u9fff]/u.test(value), "Title must contain Traditional Chinese"),
  oneLiner: z.string().min(8).max(72),
  traits: z.tuple([
    z.string().min(2).max(8),
    z.string().min(2).max(8),
    z.string().min(2).max(8)
  ]),
  motifId: z.enum([
    "compass",
    "forge",
    "prism",
    "lattice",
    "beacon",
    "scroll",
    "shield",
    "lens"
  ]),
  evidenceUrls: z.array(publicHttpsUrl).min(1).max(3)
});

export const modelResultSchema = z.object({
  title: z.string().min(1),
  verdict: z.string().min(1),
  framework: z.object({
    name: z.string().min(1),
    summary: z.string().min(1),
    useWhen: z.string().min(1),
    avoidWhen: z.string().min(1),
    steps: z
      .array(
        z.object({
          title: z.string(),
          instruction: z.string(),
          failureType: z.enum(["discipline", "shape", "omission", "conditional"])
        })
      )
      .min(2)
      .max(6)
  }),
  author: z.object({
    name: z.string(),
    handle: z.string().optional(),
    background: z.string(),
    context: z.string()
  }),
  observations: z.array(
    z.object({
      text: z.string(),
      sourceUrls: z.array(z.string().url()).min(1)
    })
  ),
  claims: z.array(
    z.object({
      text: z.string(),
      status: z.enum([
        "verified",
        "supported_inference",
        "plausible",
        "unknown_contradicted"
      ]),
      confidence: z.number().min(0).max(100),
      evidenceUrls: z.array(z.string().url()),
      score: z.object({
        directness: z.number().min(0).max(30),
        firstParty: z.number().min(0).max(20),
        corroboration: z.number().min(0).max(20),
        temporalFit: z.number().min(0).max(15),
        reproducibility: z.number().min(0).max(15),
        contradictionPenalty: z.number().min(-30).max(0)
      })
    })
  ),
  professionalDelta: z.array(
    z.object({
      competencyLabel: z.string(),
      manifestation: z.enum([
        "evidenced",
        "author_specific_extension",
        "missing_but_expected",
        "not_observable",
        "contradicted"
      ]),
      rationale: z.string(),
      evidenceUrls: z.array(z.string().url())
    })
  ),
  identityCandidates: z.array(identityCandidateSchema).length(3),
  adoption: z.array(z.string()).max(8),
  caveats: z.array(z.string()).max(8)
}).superRefine((result, context) => {
  if (new Set(result.identityCandidates.map((candidate) => candidate.title.trim())).size !== 3) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["identityCandidates"],
      message: "identity candidate titles must be distinct"
    });
  }
  result.identityCandidates.forEach((candidate, index) => {
    if (new Set(candidate.traits.map((trait) => trait.trim())).size !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identityCandidates", index, "traits"],
        message: "identity traits must be distinct"
      });
    }
  });
  result.claims.forEach((claim, index) => {
    const sum =
      claim.score.directness +
      claim.score.firstParty +
      claim.score.corroboration +
      claim.score.temporalFit +
      claim.score.reproducibility +
      claim.score.contradictionPenalty;
    if (Math.abs(claim.confidence - Math.max(0, Math.min(100, sum))) > 0.001) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claims", index, "confidence"],
        message: "confidence must equal the sum of evidence score components"
      });
    }
  });
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
