# Grill framework-selection pilot

Status: provisional decision memo

## Decision

Use Grill as a bounded design-calibration method, not as a website runtime dependency.
The selected framework for the built-in Skill Creator case is:

> Calibrate the packaging threshold from AI conversations. Use the individual and
> task category as the calibration unit; package a method as a skill only after it
> reaches that personalized threshold. After packaging, repeated corrections should
> decrease without lowering result quality.

## Candidate comparison

| Candidate | Decision | Reason |
|---|---|---|
| Calibrate the packaging threshold from conversations | Selected | It explains where the threshold comes from, the unit of calibration, and how to verify the result after packaging. |
| Validate before packaging | Keep as a short slogan | It preserves the overall direction but does not explain how different people and task categories produce different thresholds. |
| Stabilize narrow bridges and leave open fields flexible | Keep as a downstream design rule | It explains what to fix after the packaging decision, not when a method is mature enough to package. |

## Observable boundary

The framework is weakened when packaging does not reduce repeated corrections,
when output quality falls, or when exceptions continue to grow. In those cases,
return the method to an ordinary prompt or conversation and collect more evidence.

## Before / After

| Dimension | Weight | Before | After |
|---|---:|---:|---:|
| Candidate coverage | 20 | 8 | 18 |
| Evidence connection | 25 | 20 | 23 |
| Selection and rejection rationale | 25 | 5 | 23 |
| Falsifier and boundary | 15 | 8 | 14 |
| Transferability | 15 | 13 | 14 |
| **Total** | **100** | **54** | **92** |

## Go / No-go

Decision: **Go** to the internal prompt experiment.

- Improvement is 38 points, above the required 10.
- Two rejected candidates have explicit reasons.
- The falsifier is observable.
- No evidence status was raised and no unsupported factual claim was added.
- The session used five user-facing questions, including one retracted internal-taxonomy question.

The experiment must not add a website interview mode, change the public report
schema, modify the trial prompt, or make Grill a runtime dependency.

## Internal prompt experiment

Three local skill cases were sent to the configured Perplexity `sonar-pro`
research provider with the same temperature and token settings. Each case was run
once with the previous selection prompt and once with the proposed prompt. Outputs
were randomly labelled A/B and scored before the mapping was revealed.

| Case | Before | After | Delta |
|---|---:|---:|---:|
| skill-reverse | 55 | 89 | +34 |
| grill-with-docs | 53 | 88 | +35 |
| domain-modeling | 54 | 89 | +35 |
| **Median** | **54** | **89** | **+35** |

After the blind scoring, the mapping showed that A was the proposed prompt for all
three cases. All three improved candidate coverage, rejection rationale, and
observable falsifiers. Evidence discipline did not regress: the framework-selection
records cited only the supplied target URL.

Decision: **Retain** the internal prompt and schema changes.

Limitations:

- One generation per case is directional evidence, not a stable model benchmark.
- The compact outputs contained occasional sentence truncation inside bounded
  strings, so this pilot does not justify exposing selection details in the public UI.
- No production job, public report, or trial prompt was changed by the benchmark.
