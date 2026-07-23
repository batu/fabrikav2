import type { VisibilityIssue } from '../api/editorApi';

const severityRank: Record<string, number> = {
  blocked_area: 3,
  clipped: 2,
  near_border: 1,
};

export interface VisibilityWarningSummary {
  dogId: string;
  type: VisibilityIssue['type'];
  area?: string;
  viewports: string[];
  issues: VisibilityIssue[];
}

export function visibilityIssueLabel(issue: VisibilityIssue): string {
  const dog = issue.dogId ?? 'hitbox';
  const viewport = issue.viewport ?? 'mobile';
  if (issue.type === 'blocked_area') {
    return `${dog} overlaps ${issue.area ?? 'blocked area'} on ${viewport}`;
  }
  if (issue.type === 'near_border') {
    return `${dog} is near the border on ${viewport}`;
  }
  if (issue.type === 'clipped') {
    return `${dog} is clipped on ${viewport}`;
  }
  return issue.error ?? `${dog} has a mobile visibility issue`;
}

export function blockingVisibilityIssues(issues: VisibilityIssue[]): VisibilityIssue[] {
  return issues.filter((issue) => issue.type === 'blocked_area');
}

export function summarizeVisibilityIssues(issues: VisibilityIssue[]): VisibilityWarningSummary[] {
  const byDog = new Map<string, VisibilityWarningSummary>();

  for (const issue of issues) {
    const dogId = issue.dogId ?? 'hitbox';
    const current = byDog.get(dogId);
    const nextRank = severityRank[issue.type ?? ''] ?? 0;
    const currentRank = severityRank[current?.type ?? ''] ?? 0;
    const viewports = current?.viewports ?? [];
    if (issue.viewport && !viewports.includes(issue.viewport)) viewports.push(issue.viewport);

    if (!current || nextRank > currentRank) {
      byDog.set(dogId, {
        dogId,
        type: issue.type,
        area: issue.area,
        viewports,
        issues: [...(current?.issues ?? []), issue],
      });
    } else {
      current.issues.push(issue);
    }
  }

  return [...byDog.values()].sort((a, b) => a.dogId.localeCompare(b.dogId));
}

export function blockingVisibilitySummaries(summaries: VisibilityWarningSummary[]): VisibilityWarningSummary[] {
  return summaries.filter((summary) => summary.type === 'blocked_area');
}

export function visibilitySummaryLabel(summary: VisibilityWarningSummary): string {
  const viewportText = summary.viewports.length > 0
    ? summary.viewports.join(', ')
    : 'mobile';
  if (summary.type === 'blocked_area') {
    return `${summary.dogId} overlaps ${summary.area ?? 'blocked area'} on ${viewportText}`;
  }
  if (summary.type === 'clipped') {
    return `${summary.dogId} is clipped on ${viewportText}`;
  }
  if (summary.type === 'near_border') {
    return `${summary.dogId} is near the border on ${viewportText}`;
  }
  return `${summary.dogId} has a mobile visibility issue`;
}
