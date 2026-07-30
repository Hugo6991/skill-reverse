import { ArrowUpRight } from "lucide-react";
import { useLocale } from "../LocaleContext";
import type { GameIdentity, MethodTypeId } from "../types";

export function methodTypeLabel(
  identity: GameIdentity,
  labels: Record<MethodTypeId, string>
): string {
  const primary = labels[identity.primaryMethodTypeId];
  const secondary = identity.secondaryMethodTypeId
    ? labels[identity.secondaryMethodTypeId]
    : undefined;
  return secondary ? `${primary} × ${secondary}` : primary;
}

export function MethodTypeLockup({
  identity,
  label = true
}: {
  identity: GameIdentity;
  label?: boolean;
}) {
  const { copy } = useLocale();
  return (
    <div className="method-type-lockup">
      {label && <span>{copy.game.methodPersona}</span>}
      <strong>
        {methodTypeLabel(
          identity,
          copy.game.methodTypes as Record<MethodTypeId, string>
        )}
      </strong>
    </div>
  );
}

export function PersonaBeats({
  identity,
  compact = false
}: {
  identity: GameIdentity;
  compact?: boolean;
}) {
  const { copy } = useLocale();
  return (
    <div className={`persona-beats${compact ? " persona-beats-compact" : ""}`}>
      {identity.beats.map((beat) => (
        <div key={beat.kind}>
          <span>{copy.game.beatLabels[beat.kind]}</span>
          <strong>{beat.text}</strong>
        </div>
      ))}
    </div>
  );
}

export function PersonaEvidence({
  identity,
  resolveRef
}: {
  identity: GameIdentity;
  resolveRef(ref: string): string | undefined;
}) {
  const { copy } = useLocale();
  return (
    <details className="persona-evidence" data-export-hide="true">
      <summary>{copy.game.whyThisName}</summary>
      <div>
        {identity.titleRationale.map((item) => (
          <article key={item.segment}>
            <strong>{item.segment}</strong>
            <p>{item.explanation}</p>
            <ul>
              {item.evidenceRefs.map((ref) => {
                const evidence = resolveRef(ref);
                return evidence ? <li key={ref}>{evidence}</li> : null;
              })}
            </ul>
          </article>
        ))}
        <nav aria-label={copy.game.whyThisName}>
          {identity.evidenceUrls.slice(0, 2).map((url, index) => (
            <a href={url} target="_blank" rel="noreferrer" key={url}>
              {copy.game.evidence.replace("{number}", String(index + 1))}
              <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          ))}
        </nav>
      </div>
    </details>
  );
}
