/**
 * BM25 ranking implementation.
 *
 * Scores a set of documents against a query. Higher score = better match.
 * Documents are ranked by how well query terms appear in them, weighted by
 * how rare those terms are across the whole corpus.
 *
 * Parameters (industry defaults):
 *   k1 = 1.5  — TF saturation: diminishing returns on repeated terms
 *   b  = 0.75 — length normalization: penalizes longer documents slightly
 */

export interface BM25Document {
  id: string;
  text: string; // all searchable fields concatenated
}

export interface BM25Result {
  id: string;
  score: number;
}

const K1 = 1.5;
const B = 0.75;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[_\-]/g, " ") // treat underscores and hyphens as word separators
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

export function bm25Search(
  docs: BM25Document[],
  query: string,
  topK = 10
): BM25Result[] {
  if (docs.length === 0 || !query.trim()) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // Build per-document token frequencies
  const docTokens = docs.map((d) => tokenize(d.text));
  const docLengths = docTokens.map((t) => t.length);
  const avgLength = docLengths.reduce((a, b) => a + b, 0) / docs.length;

  // Build IDF: count how many documents contain each query term
  const docFreq: Record<string, number> = {};
  for (const token of queryTokens) {
    docFreq[token] = 0;
    for (const tokens of docTokens) {
      if (tokens.includes(token)) docFreq[token]++;
    }
  }

  const scores: BM25Result[] = docs.map((doc, i) => {
    const tf: Record<string, number> = {};
    for (const t of docTokens[i]) {
      tf[t] = (tf[t] ?? 0) + 1;
    }

    let score = 0;
    for (const token of queryTokens) {
      const f = tf[token] ?? 0;
      if (f === 0) continue;

      const df = docFreq[token];
      // IDF formula: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((docs.length - df + 0.5) / (df + 0.5) + 1);

      // TF normalization with length penalty
      const tfNorm =
        (f * (K1 + 1)) /
        (f + K1 * (1 - B + B * (docLengths[i] / avgLength)));

      score += idf * tfNorm;
    }

    return { id: doc.id, score };
  });

  return scores
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
