import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { useMemo } from "react";
import type { ReverseReport } from "../types";

function nodeType(id: string) {
  if (id.startsWith("source") || id.startsWith("tweet")) return "source";
  if (id.startsWith("observation") || id.startsWith("obs-")) return "observation";
  return "claim";
}

export function EvidenceGraph({ report }: { report: ReverseReport }) {
  const { nodes, edges } = useMemo(() => {
    const labels = new Map<string, string>();
    report.sources.forEach((item) => labels.set(item.id, item.title));
    report.observations.forEach((item) => labels.set(item.id, item.text));
    report.claims.forEach((item) => labels.set(item.id, item.text));

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
      label: edge.relation.replaceAll("_", " "),
      type: "smoothstep",
      animated: edge.relation === "contradicts",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: edge.relation === "contradicts" ? "#c94c34" : "#62756e" }
    }));
    return { nodes, edges };
  }, [report]);

  return (
    <div className="evidence-graph" aria-label="Evidence relationship graph">
      <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.45} maxZoom={1.4}>
        <Background color="#b9b9af" gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
