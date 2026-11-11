// src/outreach/personalized-hook-composer.ts

export interface HookInput {
  company: string;
  roleTitle: string;
  personName?: string;
  personRole?: string;
  discoveryStep?: string;
}

export function composeTechnicalOpenerHook(input: HookInput): string {
  const firstName = input.personName?.trim() ? input.personName.trim().split(/\s+/)[0] : '';
  const greeting =
    firstName && !/^(unknown|team|hiring|talent|there)$/i.test(firstName)
      ? `Hi ${firstName},`
      : `Hi ${input.company} Engineering Team,`;

  const rawRole = input.personRole?.trim() || '';
  const artifactMatch =
    rawRole.match(/\(([^)]+)\)/)?.[1]?.trim() ||
    rawRole.match(/(?:maintaining|maintains|maintainer\s+of|contributor\s+to|commits?\s+on|working\s+on|repo:|pkg:|package:)\s+([@a-z0-9_./-]+)/i)?.[1]?.trim() ||
    (rawRole && !/^(engineer|developer|lead|team|contributor|head|director|manager|founder|co-founder)/i.test(rawRole)
      ? rawRole
      : undefined);

  const isNpm =
    input.discoveryStep === 'inversion1_npm_maintainer_registry' ||
    input.discoveryStep === 'mode2_npm_maintainer' ||
    /npm/i.test(input.discoveryStep || '') ||
    /npm|package|pkg|maintain/i.test(rawRole);

  const isGit =
    input.discoveryStep === 'inversion2_git_patch_header' ||
    input.discoveryStep === 'github_org_events' ||
    input.discoveryStep === 'mode2_git_patch' ||
    /git/i.test(input.discoveryStep || '') ||
    /github|repo|commit|patch/i.test(rawRole);

  if (isNpm && artifactMatch) {
    return `${greeting}\n\nI came across your work maintaining the ${artifactMatch} package while researching ${input.company}'s engineering stack, and wanted to reach out after applying for the ${input.roleTitle} role.`;
  }
  if (isGit && artifactMatch) {
    return `${greeting}\n\nI saw your recent engineering contributions to ${artifactMatch} on GitHub and wanted to connect directly after applying for the ${input.roleTitle} position at ${input.company}.`;
  }
  return `${greeting}\n\nI recently submitted my application for the ${input.roleTitle} role at ${input.company} and wanted to share a quick overview of my production engineering work.`;
}

export function composeDay5FollowUpWithNewProof(input: HookInput): { subject: string; body: string } {
  return {
    subject: `Re: Applied for ${input.roleTitle} — Shivam Mahajan (Morgan Stanley / CSE '26)`,
    body:
      `Following up briefly on my application for the ${input.roleTitle} role at ${input.company}.\n\n` +
      `In addition to my work at Morgan Stanley (engineering Apache Kafka, PySpark, and Azure Snowflake CIAM pipelines processing 5,000,000+ events with zero row-count tolerance), ` +
      `I also recently open-sourced a high-concurrency WebSocket engine (QuizDeck, benchmarked for 500 concurrent users at 31 ms latency) and a bidirectional ClickHouse OLAP ingestion tool (shivammahajan.com/projects/).\n\n` +
      `I am based in Bengaluru with immediate (0-day) availability and would welcome a brief conversation if my background aligns with your team's roadmap.\n\nBest regards,\nShivam Mahajan`,
  };
}
