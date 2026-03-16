# BM25 Search in Skills Manager

## Why BM25

The original search was an exact substring match — `skillsmanager search "linkedin post"` would only
match if that exact phrase appeared in the skill name or description. BM25 replaces this with
ranked, token-based search so queries like `"post on linkedin"` or `"linkedin"` both surface
`write_linkedin_post`.

## How BM25 Works

BM25 (Best Match 25) is the ranking algorithm used by Elasticsearch, Solr, and Lucene. Given a
query and a corpus of documents, it scores each document using three factors:

### 1. Term Frequency (TF) — with diminishing returns

How often does a query token appear in the document? But the relationship is sublinear: seeing
a word 10 times isn't 10× better than seeing it once. The `k1` parameter controls saturation.

```
TF score = (freq × (k1 + 1)) / (freq + k1 × (1 - b + b × (docLen / avgLen)))
```

### 2. Inverse Document Frequency (IDF) — rare terms score higher

A term that appears in many documents carries little signal. `"post"` appearing in 30/50 skills
is weak. `"linkedin"` appearing in 1/50 is strong.

```
IDF = log((N - df + 0.5) / (df + 0.5) + 1)
```

Where `N` = total documents, `df` = documents containing the term.

### 3. Document Length Normalization

A short description that matches is stronger signal than a long description with the same match
count. The `b` parameter controls how much length is penalized.

### Parameters

| Parameter | Value | Effect |
|---|---|---|
| `k1` | 1.5 | TF saturation — diminishing returns on repeated terms |
| `b` | 0.75 | Length normalization — longer docs penalized slightly |

These are the widely accepted defaults used in search engines.

## Implementation in Skills Manager

**File:** `src/bm25.ts`

**Tokenization:** text is lowercased, underscores and hyphens are converted to spaces (so
`write_linkedin_post` tokenizes to `["write", "linkedin", "post"]`), then split on whitespace.

**Name weighting:** skill names are repeated 3× in the document text before indexing. This
ensures a name match outranks a description-only match for the same token.

```ts
text: `${name} ${name} ${name} ${description}`
```

**Output:** results are returned ranked by score (highest first), zero-score results excluded.

## Example Behaviour

Corpus:
```
write_linkedin_post   — "Writes LinkedIn posts for professional networking"
send_email            — "Sends email with a subject and body"
draft_social_post     — "Drafts a social media post for any platform"
```

| Query | Old (substring) | BM25 |
|---|---|---|
| `linkedin` | ✅ write_linkedin_post | ✅ write_linkedin_post |
| `linkedin post` | ❌ no exact phrase | ✅ write_linkedin_post, then draft_social_post |
| `post on linkedin` | ❌ | ✅ write_linkedin_post (linkedin rare → high IDF) |
| `social post` | ❌ | ✅ draft_social_post |
| `email` | ✅ send_email | ✅ send_email |

## Limitations

BM25 is still keyword-based. It won't match synonyms or paraphrases:

- `"compose an update"` → won't match `write_linkedin_post` (different tokens)
- `"message someone"` → won't match `send_email`

For true semantic matching, embeddings (e.g. via Claude API) would be needed. Given the small
corpus size typical of Skills Manager collections, BM25 covers the practical cases well without any
external dependencies or API calls.
