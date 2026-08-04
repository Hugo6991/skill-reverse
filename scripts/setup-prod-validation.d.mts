export interface SmokeReportValidation {
  ok: boolean;
  report: Record<string, unknown> | null;
  sourceCount: number;
}

export function resolveSmokeReport(payload: unknown): unknown;
export function validateSmokeReport(payload: unknown): SmokeReportValidation;
