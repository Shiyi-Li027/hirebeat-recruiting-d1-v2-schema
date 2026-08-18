import { normalizeEmail, normalizePhone, normalizedUrl, normalizeWhitespace } from "./crypto";

export interface IdentityCandidate {
  type: "email" | "phone" | "linkedin_url" | "github_url";
  value: string;
  accountHandle: string | null;
}

export interface EducationCandidate {
  rawText: string;
  schoolName: string | null;
  degreeName: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface EmploymentCandidate {
  rawText: string;
  companyName: string | null;
  positionName: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: number | null;
}

export interface ProjectCandidate {
  rawText: string;
  projectName: string | null;
  projectUrl: string | null;
}

interface SectionMap { education: string[]; employment: string[]; skills: string[]; projects: string[]; }

const HEADINGS: Array<[keyof SectionMap, RegExp]> = [
  ["education", /^(education|academic background|academics)$/i],
  ["employment", /^(experience|work experience|employment|professional experience|internships?)$/i],
  ["skills", /^(skills|technical skills|technologies|core competencies)$/i],
  ["projects", /^(projects|selected projects|academic projects|personal projects)$/i],
];

function sections(text: string): SectionMap {
  const result: SectionMap = { education: [], employment: [], skills: [], projects: [] };
  let current: keyof SectionMap | null = null;
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const heading = HEADINGS.find(([, pattern]) => pattern.test(line.replace(/[:|]$/, "").trim()));
    if (heading) { current = heading[0]; continue; }
    if (current) result[current].push(rawLine);
  }
  return result;
}

function blocks(lines: string[]): string[] {
  const joined = lines.join("\n").trim();
  if (!joined) return [];
  const separated = joined.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean);
  if (separated.length > 1) return separated;
  const sourceLines = joined.split("\n").map((item) => item.trim()).filter(Boolean);
  const result: string[] = [];
  let buffer: string[] = [];
  for (const line of sourceLines) {
    if (buffer.length >= 2 && /(?:19|20)\d{2}|present|current/i.test(line)) {
      buffer.push(line); result.push(buffer.join("\n")); buffer = [];
    } else buffer.push(line);
  }
  if (buffer.length) result.push(buffer.join("\n"));
  return result;
}

function dateRange(text: string): {startDate:string|null;endDate:string|null;isCurrent:number|null} {
  const values = [...text.matchAll(/\b((?:19|20)\d{2})(?:[-/.](0?[1-9]|1[0-2]))?\b/g)]
    .map((match) => `${match[1]}-${String(match[2] ?? "01").padStart(2,"0")}`);
  return {
    startDate: values[0] ?? null,
    endDate: /present|current/i.test(text) ? null : values[1] ?? null,
    isCurrent: /present|current/i.test(text) ? 1 : values.length ? 0 : null,
  };
}

export function extractIdentityCandidates(text: string): IdentityCandidate[] {
  const found = new Map<string, IdentityCandidate>();
  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const value = normalizeEmail(match[0]);
    if (value) found.set(`email:${value}`, { type:"email", value, accountHandle:null });
  }
  for (const match of text.matchAll(/(?:\+?\d[\d().\s-]{6,}\d)/g)) {
    const value = normalizePhone(match[0]);
    if (value) found.set(`phone:${value}`, { type:"phone", value, accountHandle:null });
  }
  for (const match of text.matchAll(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Z0-9_%.-]+\/?/gi)) {
    const value = normalizedUrl(match[0]);
    if (value) found.set(`linkedin_url:${value}`, {type:"linkedin_url",value,accountHandle:value.split("/").at(-1)??null});
  }
  for (const match of text.matchAll(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Z0-9_.-]+\/?/gi)) {
    const value = normalizedUrl(match[0]);
    if (value) found.set(`github_url:${value}`, {type:"github_url",value,accountHandle:value.split("/").at(-1)??null});
  }
  return [...found.values()];
}

export function extractEducation(text: string): EducationCandidate[] {
  return blocks(sections(text).education).map((rawText) => {
    const lines = rawText.split("\n").map((line)=>normalizeWhitespace(line)).filter((line):line is string=>Boolean(line));
    const degreeLine = lines.find((line)=>/bachelor|master|ph\.?d|doctor|associate|b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?a\.?/i.test(line)) ?? null;
    const dates = dateRange(rawText);
    return { rawText, schoolName: lines.find((line)=>line!==degreeLine && !/(?:19|20)\d{2}/.test(line))??lines[0]??null, degreeName:degreeLine, startDate:dates.startDate,endDate:dates.endDate };
  });
}

export function extractEmployment(text: string): EmploymentCandidate[] {
  return blocks(sections(text).employment).map((rawText) => {
    const lines = rawText.split("\n").map((line)=>normalizeWhitespace(line)).filter((line):line is string=>Boolean(line));
    const content = lines.filter((line)=>!/(?:19|20)\d{2}|present|current/i.test(line));
    const dates = dateRange(rawText);
    return { rawText, companyName:content[0]??null, positionName:content[1]??null,
      startDate:dates.startDate,endDate:dates.endDate,isCurrent:dates.isCurrent };
  });
}

export function extractProjects(text: string): ProjectCandidate[] {
  return blocks(sections(text).projects).map((rawText) => {
    const lines=rawText.split("\n").map((line)=>normalizeWhitespace(line)).filter((line):line is string=>Boolean(line));
    const urlMatch=rawText.match(/https?:\/\/[^\s)]+/i)?.[0]??null;
    return {rawText,projectName:lines[0]??null,projectUrl:urlMatch};
  });
}

export function skillSectionText(text: string): string {
  return sections(text).skills.join("\n");
}
