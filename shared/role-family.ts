export const ROLE_FAMILIES: Record<string, RegExp> = {
  // Hardware/silicon terms matter here specifically because the semiconductor
  // GCCs (Qualcomm, TI, AMD, Infineon, Microchip) are now covered, and their
  // India design centres hire freshers heavily.
  swe: /\b(software|engineer|developer|sde|swe|programmer|full[- ]?stack|backend|back[- ]end|frontend|front[- ]end|mobile|android|ios|platform|infrastructure|devops|sre|reliability|qa|quality assurance|sdet|test|automation|security engineer|systems|embedded|firmware|vlsi|rtl|asic|fpga|silicon|physical design)\b/i,
  data: /\b(data|machine learning|\bml\b|\bai\b|analytics|scientist|research|nlp|computer vision|deep learning|quantitative|quant)\b/i,
  finance: /\b(analyst|associate|consultant|advisory|investment|risk|\bgrc\b|\btprm\b|compliance|treasury|\btax\b|trading|trader|actuar|audit|finance|banking|strategy|operations analyst)\b/i,
  // Product and program work is a standard CS-grad path; `manager` still gates
  // the senior end, so in practice this surfaces APM/Product Analyst/Product
  // Owner rather than the manager rungs.
  product: /\b(product manager|product owner|product analyst|associate product|\bapm\b|program manager|programme manager|technical program|project manager|scrum|business analyst)\b/i,
  design: /\b(designer|\bux\b|\bui\b|user experience|user research|product design|interaction design)\b/i,
  security: /\b(security|cyber|infosec|penetration test|appsec|threat|vulnerability|identity (?:&|and) access)\b/i,
};

const FINANCE_INDUSTRIES = new Set(['banking', 'consulting', 'quant']);

export function roleFamily(title: string, industry: string): string | null {
  for (const [family, pattern] of Object.entries(ROLE_FAMILIES)) {
    if (family === 'finance' && !FINANCE_INDUSTRIES.has(industry)) continue;
    if (pattern.test(title)) return family;
  }
  return null;
}
