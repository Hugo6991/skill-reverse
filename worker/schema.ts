import { z } from "zod";

const publicHttpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith("https://"), "Only public HTTPS URLs are supported");

export const createJobSchema = z.object({
  targetUrl: publicHttpsUrl,
  supportUrls: z.array(publicHttpsUrl).max(8).default([]),
  occupationCode: z.string().regex(/^\d{2}-\d{4}\.\d{2}$/),
  turnstileToken: z.string().min(1).max(2048)
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

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
  adoption: z.array(z.string()).max(8),
  caveats: z.array(z.string()).max(8)
});

export type ModelResult = z.infer<typeof modelResultSchema>;
