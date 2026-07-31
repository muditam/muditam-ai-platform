import {
  structuredReportSchema,
  type StructuredReport,
} from "../contracts/structured-report.js";

export function mergeStructuredReports(
  base: StructuredReport,
  additions: StructuredReport[],
): StructuredReport {
  if (additions.length === 0) return base;
  const panels = [
    ...base.panels,
    ...additions.flatMap((report) => report.panels),
  ];
  const unclassifiedContent = [
    ...base.unclassifiedContent,
    ...additions.flatMap((report) => report.unclassifiedContent),
  ];
  const observationCount = panels.reduce(
    (total, panel) => total + panel.observations.length,
    0,
  );
  const confidenceValues = [
    ...(base.statistics.observationCount > 0
      ? [base.layoutAnalysis.confidence]
      : []),
    ...additions
      .filter((report) => report.statistics.observationCount > 0)
      .map((report) => report.layoutAnalysis.confidence),
  ];
  const layoutConfidence =
    confidenceValues.length === 0
      ? 0
      : Math.min(...confidenceValues);
  return structuredReportSchema.parse({
    ...base,
    status: unclassifiedContent.length > 0 ? "PARTIAL" : "STRUCTURED",
    layoutAnalysis: {
      ...base.layoutAnalysis,
      confidence: layoutConfidence,
      evidenceRowCount: observationCount,
    },
    panels,
    unclassifiedContent,
    statistics: {
      observationCount,
      classifiedLineCount:
        base.statistics.classifiedLineCount +
        additions.reduce(
          (total, report) =>
            total + report.statistics.classifiedLineCount,
          0,
        ),
      unclassifiedLineCount: unclassifiedContent.length,
    },
  });
}
