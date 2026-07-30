import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { useMemo } from "react";
import { useLocale } from "../LocaleContext";
import { track } from "../analytics";
import { withoutTerminalFullStop } from "../text";
import type { ReverseReport } from "../types";

function nodeType(id: string) {
  if (id.startsWith("source") || id.startsWith("tweet")) return "source";
  if (id.startsWith("observation") || id.startsWith("obs-")) return "observation";
  return "claim";
}

export function EvidenceGraph({ report }: { report: ReverseReport }) {
  const { copy } = useLocale();
  const relationLabels = {
    supports: copy.report.supports,
    contradicts: copy.report.contradicts,
    derived_from: copy.report.derivedFrom,
    baseline_for: copy.report.baselineFor
  };
  const { nodes, edges } = useMemo(() => {
    const labels = new Map<string, string>();
    report.sources.forEach((item) => labels.set(item.id, item.title));
    report.observations.forEach((item) =>
      labels.set(item.id, withoutTerminalFullStop(item.text))
    );
    report.claims.forEach((item) =>
      labels.set(item.id, withoutTerminalFullStop(item.text))
    );

    const ids = [...new Set(report.edges.flatMap((edge) => [edge.source, edge.target]))];
    const columns = { source: 0, observation: 1, claim: 2 };
    const counts = { source: 0, observation: 0, claim: 0 };
    const nodes: Node[] = ids.map((id) => {
      const type = nodeType(id) as keyof typeof columns;
      const row = counts[type]++;
      return {
        id,
        position: { x: columns[type] * 310, y: row * 126 },
        data: { label: labels.get(id) ?? id },
        className: `evidence-node evidence-${type}`
      };
    });
    const edges: Edge[] = report.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: relationLabels[edge.relation],
      type: "smoothstep",
      animated: edge.relation === "contradicts",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: edge.relation === "contradicts" ? "#c94c34" : "#62756e" }
    }));
    return { nodes, edges };
  }, [copy.report, report]);

  return (
    <div className="evidence-graph" aria-label={copy.report.graphAria}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.45}
        maxZoom={1.4}
        onNodeClick={() =>
          track("evidence_opened", {
            report_type: report.id === "demo" ? "demo" : "published"
          })
        }
      >
        <Background color="#b9b9af" gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
