# OSCAR Privacy Guard Engine Specification

## 1. Purpose & Security Mandate
The **Privacy Guard Engine** is the foundational security boundary of OSCAR. It guarantees that sensitive personally identifiable information (PII) and credentials never leave the local application environment when prompts are transmitted to external AI providers.

The engine executes locally on the server gateway as a pure, deterministic, zero-network module.

---

## 2. PII Detection Rules & Heuristics

The engine executes a priority-ordered cascade of deterministic regular expressions and heuristic tokenizers. Priority order ensures that compound patterns (such as API keys containing letters and numbers) are not prematurely broken up by broader patterns:

| Priority | PII Category | Token Identifier | Regex Pattern & Heuristic Specification | Example Matches |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **API / Secret Key** | `[SECRET_KEY_N]` | `(?i)(?:bearer\s+[a-z0-9_\-\.]{20,}\|ghp_[a-z0-9]{36}\|ai[a-z0-9_\-]{30,}\|(?:sk-[a-z0-9]{32,}))` | `ghp_1234567890abcdef1234567890abcdef1234`, `Bearer eyJhbGciOi...` |
| **2** | **IBAN** | `[IBAN_N]` | `\b[A-Z]{2}[0-9]{2}(?:[ ]?[0-9]{4}){4,7}(?:[ ]?[0-9]{1,4})?\b` | `DE89 3704 0044 0532 0130 00`, `PL61109010140000071219812874` |
| **3** | **Email Address** | `[EMAIL_N]` | `\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b` | `contact@example.com`, `user@domain.co.uk` |
| **4** | **Phone Number** | `[PHONE_N]` | `(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b` | `+49 170 1234567`, `(030) 9876-5432`, `+1-800-555-0199` |
| **5** | **Monetary Amount** | `[AMOUNT_MONEY_N]` | `(?:\$|€|£|PLN|EUR|USD)\s?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\|\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\s?(?:€|\$|£|PLN|EUR|USD)\b` | `15000 EUR`, `$450.00`, `2.500,00 €`, `49,99 PLN` |
| **6** | **Person / Name** | `[PERSON_N]` | `(?:\b(?:Herr|Frau|Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\|(?:(?<=\bwith\s+\|\bmeeting\s+\|\bcall\s+\|\bfor\s+)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)` | `Mr. John Doe`, `meeting Alice Newman`, `with Bob Miller` |

### Edge Case Handling:
1. **Punctuation Immunity:** Boundaries (`\b`) and lookaheads prevent swallowing sentence-ending punctuation (e.g., `user@example.com.` will correctly isolate `user@example.com` and leave the terminal period untouched).
2. **Whitespace Normalization:** IBANs with or without spacing are treated uniformly.
3. **Currency Invariance:** Prefixed (`$100`) and suffixed (`100 EUR`) currency notations are both captured.

---

## 3. Right-to-Left String Substitution Algorithm

When replacing multiple substrings within a single text, replacing from left to right causes index shifts: modifying an earlier slice changes the character offsets of every subsequent match.

To preserve absolute index validity without costly string rebuilds, the Privacy Guard strictly sorts all collected matches in **descending order by `startIndex`** (Right-to-Left):

```mermaid
flowchart TD
    Raw["Raw Text Input"] --> Scan["Execute Regex Matchers"]
    Scan --> Collect["Collect Match Coordinates (start, end, value, type)"]
    Collect --> Dedupe["Deduplicate & Resolve Overlapping Spans"]
    Dedupe --> Sort["Sort Descending by startIndex (Right-to-Left)"]
    Sort --> Replace["Splice Substrings from End to Beginning"]
    Replace --> TokenMap["Generate Token Map { token -> originalValue }"]
    TokenMap --> Result["Return SanitizationResult"]
```

### TypeScript Implementation Blueprint:

```typescript
import { PIITokenMap, PIIType, SanitizationResult } from '../types/contracts';

interface RawMatch {
  type: PIIType;
  value: string;
  startIndex: number;
  endIndex: number;
}

export class PrivacyGuard {
  private static readonly COUNTERS: Record<PIIType, number> = {
    SECRET_KEY: 0,
    IBAN: 0,
    EMAIL: 0,
    PHONE: 0,
    AMOUNT_MONEY: 0,
    PERSON: 0
  };

  /**
   * Masks sensitive information using Right-to-Left replacement.
   */
  public static mask(text: string): SanitizationResult {
    const matches: RawMatch[] = this.collectAllMatches(text);
    const nonOverlapping = this.resolveOverlaps(matches);

    // Sort descending by startIndex (Right-to-Left)
    nonOverlapping.sort((a, b) => b.startIndex - a.startIndex);

    let sanitized = text;
    const tokens: PIITokenMap[] = [];
    const typeCounters: Record<string, number> = {};

    for (const match of nonOverlapping) {
      typeCounters[match.type] = (typeCounters[match.type] || 0) + 1;
      const token = `[${match.type}_${typeCounters[match.type]}]`;

      // Splice replacement safely without altering preceding character offsets
      sanitized =
        sanitized.substring(0, match.startIndex) +
        token +
        sanitized.substring(match.endIndex);

      tokens.push({
        token,
        type: match.type,
        originalValue: match.value,
        startIndex: match.startIndex,
        endIndex: match.startIndex + token.length
      });
    }

    return {
      sanitizedText: sanitized,
      tokenCount: tokens.length,
      tokens: tokens.reverse(), // Restore sequential order for map consumers
      timestamp: new Date().toISOString(),
      riskLevel: this.calculateRisk(tokens.length, tokens.map(t => t.type))
    };
  }

  private static resolveOverlaps(matches: RawMatch[]): RawMatch[] {
    // Sort ascending by startIndex, then longest match first
    matches.sort((a, b) => a.startIndex - b.startIndex || (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex));
    const result: RawMatch[] = [];
    let lastEnd = 0;

    for (const match of matches) {
      if (match.startIndex >= lastEnd) {
        result.push(match);
        lastEnd = match.endIndex;
      }
    }
    return result;
  }

  private static calculateRisk(count: number, types: PIIType[]): 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' {
    if (count === 0) return 'NONE';
    if (types.includes('SECRET_KEY') || types.includes('IBAN')) return 'HIGH';
    if (count >= 3) return 'HIGH';
    if (count === 2) return 'MEDIUM';
    return 'LOW';
  }
}
```

---

## 4. Recursive JSON Re-hydration Algorithm

AI model inference returns a structured JSON payload conforming to `ExtractedTaskSchema`. This object contains the synthetic tokens injected during masking (e.g., `title: "Call [PERSON_1] regarding [AMOUNT_MONEY_1]"`).

The re-hydration algorithm performs a complete, depth-first recursive walk through all strings, arrays, and nested records, replacing all token occurrences with their cleartext original values:

```typescript
export function rehydrate<T>(target: T, tokenMap: Map<string, string>): T {
  // Base case 1: String primitive
  if (typeof target === 'string') {
    let replaced = target;
    for (const [token, originalValue] of tokenMap.entries()) {
      if (replaced.includes(token)) {
        replaced = replaced.replaceAll(token, originalValue);
      }
    }
    return replaced as unknown as T;
  }

  // Base case 2: Array elements
  if (Array.isArray(target)) {
    return target.map(item => rehydrate(item, tokenMap)) as unknown as T;
  }

  // Base case 3: Nested object structures
  if (target !== null && typeof target === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(target)) {
      clone[key] = rehydrate(value, tokenMap);
    }
    return clone as unknown as T;
  }

  // Base case 4: Non-string primitives (numbers, booleans, null, undefined)
  return target;
}
```

---

## 5. Test Suite & Acceptance Criteria (Vitest Target: >= 95% Coverage)

The test suite located at `server/tests/privacy/PrivacyGuard.spec.ts` must execute against **Vitest** with 100% in-memory isolation (no network, no disk, execution time < 50ms).

### Core Acceptance Tests:

1. **Deterministic Roundtrip Invariance:**
   $$\forall \text{ text},\quad \text{rehydrate}(\text{mask}(\text{text}).\text{sanitizedText}, \text{tokenMap}) \equiv \text{text}$$
2. **Dense Multi-Entity Detection:**
   A prompt containing all 6 PII types simultaneously must replace all 6 without index collision or regex starvation.
3. **Repeated Entity Deduplication / Consistency:**
   If the name `Alice Newman` occurs 3 times in a single memo, each occurrence is assigned a consistent token mapping, and all 3 instances re-hydrate flawlessly.
4. **Adversarial & Boundary Verification:**
   * Text with no PII produces identical string, `tokenCount: 0`, and `riskLevel: 'NONE'`.
   * Strings with complex punctuation (e.g. `(email: user@example.com).`) do not swallow parentheses or trailing periods.
   * Unicode characters (German umlauts `ä, ö, ü, ß`, Polish diacritics `ą, ę, ł, ś, ć, ż, ź`) are preserved accurately across masking and re-hydration.
5. **Coverage Guarantee:**
   Statements, branches, functions, and lines in `server/src/privacy/` must meet or exceed **95% coverage** as reported by `c8` / `@vitest/coverage-v8`.
