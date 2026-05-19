/**
 * llms.txt content validation — routes, artifacts, local link targets.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(harnessDir, '../..');

const LINK_PATTERNS = [
  /\]\((\.\/[^)\s]+)\)/g,
  /`(\.\/[^`\s]+)`/g,
  /`((?:workers|dashboard|docs)\/[^`\s]+)`/g,
  /(?:^|\s)(\.\/(?:workers|docs|dashboard)[^\s]*)/gm,
];

export function extractLlmsLocalPaths(llmsContent) {
  const paths = new Set();
  for (const re of LINK_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(llmsContent))) {
      let p = m[1].trim();
      p = p.replace(/[.,;:!?)]+$/, '');
      if (p.includes(' ')) continue;
      paths.add(p);
    }
  }
  return [...paths].sort();
}

export function verifyLlmsLocalLinks(llmsContent, { repoRoot: root = repoRoot } = {}) {
  const findings = [];
  for (const rel of extractLlmsLocalPaths(llmsContent)) {
    const cleaned = rel.startsWith('./') ? rel.slice(2) : rel;
    const full = resolve(root, cleaned);
    const normalizedRoot = normalize(root);
    if (!full.startsWith(normalizedRoot)) {
      findings.push(`llms.txt link escapes repo: ${rel}`);
      continue;
    }
    if (!existsSync(full)) {
      findings.push(`llms.txt broken local link: ${rel}`);
    }
  }
  return findings;
}

export function verifyLlmsHarnessArtifacts(llmsContent) {
  const findings = [];
  const required = [
    'dashboard/harness',
    'workers/fantasy402-ingestion/openapi.worker.json',
    'workers/fantasy402-ingestion/upstream-endpoints.json',
    'docs/dashboard.md',
    'AGENTS.md',
  ];
  for (const frag of required) {
    if (!llmsContent.includes(frag)) {
      findings.push(`llms.txt must reference harness artifact: ${frag}`);
    }
  }
  return findings;
}

export function runLlmsContentValidation(llmsContent, { dashboardRoutes, harnessMetaFiles }) {
  const findings = [];
  findings.push(...verifyLlmsHarnessArtifacts(llmsContent));
  findings.push(...verifyLlmsLocalLinks(llmsContent));

  for (const route of dashboardRoutes ?? []) {
    if (route.public) continue;
    const bare = route.path.split('?')[0];
    if (!llmsContent.includes(bare)) {
      findings.push(`llms.txt missing route ${bare}`);
    }
  }

  for (const file of harnessMetaFiles ?? []) {
    const frag = `metadata/${file}`;
    if (!llmsContent.includes('harness') && !llmsContent.includes(frag)) {
      findings.push(`llms.txt should mention harness metadata/${file}`);
    }
  }

  return findings;
}
