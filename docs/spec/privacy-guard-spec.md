# OSCAR Privacy Guard Engine Specification

## 1. Purpose & Security Mandate
The **Privacy Guard Engine** is the foundational security boundary of OSCAR. It guarantees that sensitive personally identifiable information (PII) and credentials never leave the local application environment when prompts are transmitted to external AI providers.

The engine executes locally on the server gateway as a pure, deterministic, zero-network module.

---

## 2. PII Detection Rules & Heuristics

The engine executes a priority-ordered cascade of deterministic regular expressions and heuristic tokenizers. The explicit category priority hierarchy (`SECRET_KEY: 1`, `IBAN: 2`, `EMAIL: 3`, `PHONE: 4`, `AMOUNT_MONEY: 5`, `PERSON: 6`) ensures that compound patterns (such as API keys containing letters and numbers) are not prematurely fragmented by broader tokenizers.

All regular expressions adhere strictly to ECMAScript (Node.js V8) standard syntax. Explicit RegExp flags (`giu` or `gu`) are compiled programmatically—inline `(?i)` flag syntax is strictly forbidden to prevent fatal `SyntaxError` exceptions at runtime.

| Priority | PII Category | Token Identifier | RegExp Pattern (ECMAScript) | Flags | Example Matches |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **API / Secret Key** | `[SECRET_KEY_N]` | `\b(?:bearer\s+[a-z0-9_\-\.]{20,}\|ghp_[a-z0-9]{36}\|ai[a-z0-9_\-]{30,}\|sk-[a-z0-9]{32,})\b` | `giu` | `ghp_1234567890abcdef1234567890abcdef1234`, `Bearer eyJhbGciOi...` |
| **2** | **IBAN** | `[IBAN_N]` | `\b[A-Z]{2}[0-9]{2}(?:[ ]?[0-9]{4}){4,7}(?:[ ]?[0-9]{1,4})?\b` | `gu` | `DE89 3704 0044 0532 0130 00`, `PL61109010140000071219812874` |
| **3** | **Email Address** | `[EMAIL_N]` | `\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b` | `giu` | `contact@example.com`, `user@domain.co.uk` |
| **4** | **Phone Number** | `[PHONE_N]` | `(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b` | `gu` | `+49 170 1234567`, `(030) 9876-5432`, `+1-800-555-0199` |
| **5** | **Monetary Amount** | `[AMOUNT_MONEY_N]` | `(?:\$|€|£|PLN|EUR|USD)\s?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\|\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\s?(?:€|\$|£|PLN|EUR|USD)\b` | `giu` | `15000 EUR`, `$450.00`, `2.500,00 €`, `49,99 PLN` |
| **6** | **Person / Name** | `[PERSON_N]` | `(?:\b(?:Herr|Frau|Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)\s+\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)\|(?:(?<=\b(?:with\|meeting\|call\|for\|from\|by\|to\|contact\|assigned to)\s+)\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)+)` | `gu` | `Mr. John Doe`, `meeting Alice Newman`, `with Bob Miller`, `call Jürgen Müller`, `for Michał Kowalski`, `contact François Dupond` |

> [!NOTE]
> **Markdown Table Syntax Note:** Alternation pipes within the regex table are escaped with a backslash (`\|`) to prevent breaking Markdown table cell delimiters. In TypeScript/JavaScript code, use unescaped standard alternation pipes (`|`).

### Unicode & Internationalization Specification:
1. **Unicode Property Escapes (`\p{Lu}\p{Ll}+` with `u` flag):** The `PERSON` detector avoids ASCII-only `[A-Z][a-z]+` constraints, accurately matching European personal names containing umlauts, accents, and diacritics (e.g., `Jürgen Müller`, `Michał Kowalski`, `François Dupond`).
2. **Context Trigger Boundaries:** Person names are extracted via deterministic honorific prefixes (`Mr.`, `Ms.`, `Mrs.`, `Dr.`, `Prof.`, `Herr`, `Frau`) or relational action markers (`with`, `meeting`, `call`, `for`, `from`, `by`, `to`, `contact`, `assigned to`).
3. **Punctuation Immunity:** Word boundaries (`\b`) and positive lookbehinds isolate the entities without capturing surrounding punctuation or enclosing sentence periods (e.g., in `contact contact@example.com.`, the trailing dot remains unmasked).
4. **Currency Invariance:** Prefixed (`$100`) and suffixed (`100 EUR`) currencies are supported across international number formats (periods and commas as decimal or thousand separators).

---

## 3. Masking Algorithm (Right-to-Left Substitution with Deduplication)

When replacing multiple substrings within a single text, replacing from left to right causes index shifts: modifying an earlier slice invalidates the character offsets of every subsequent match.

To preserve absolute index validity without costly string rebuilds, the Privacy Guard:
1. Scans all candidate matches across all categories.
2. Resolves overlapping candidate spans using the **Priority Hierarchy** (lower priority number wins).
3. Deduplicates identical entity occurrences using a normalized entity-to-token map (`entityToToken: Map<string, string>`) so repeated entities receive identical tokens (`[PERSON_1]`).
4. Sorts all resolved match instances in **descending order by `startIndex`** (Right-to-Left).
5. Slices and substitutes each token from back to front.

```mermaid
flowchart TD
    Raw["Raw Text Input"] --> Scan["Execute ECMAScript Regex Matchers (with explicit flags)"]
    Scan --> Collect["Collect All Raw Matches (startIndex, endIndex, value, type)"]
    Collect --> Overlap["Priority-Weighted Overlap Resolution (1: SECRET_KEY -> 6: PERSON)"]
    Overlap --> Dedupe["Entity Deduplication (Normalize & Map repeated entities to same token)"]
    Dedupe --> Sort["Sort Descending by startIndex (Right-to-Left)"]
    Sort --> Splice["Splice Substrings from End to Beginning"]
    Splice --> Out["Emit SanitizedResult (sanitizedText, ephemeral tokenMap, riskLevel)"]
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

const CATEGORY_PRIORITY: Record<PIIType, number> = {
  SECRET_KEY: 1,
  IBAN: 2,
  EMAIL: 3,
  PHONE: 4,
  AMOUNT_MONEY: 5,
  PERSON: 6
};

export class PrivacyGuard {
  /**
   * Masks sensitive information using Priority Overlap Resolution and Right-to-Left replacement.
   */
  public static mask(text: string): SanitizationResult {
    const rawMatches: RawMatch[] = this.collectAllMatches(text);
    const nonOverlapping = this.resolveOverlaps(rawMatches);

    // Entity deduplication map (normalized entity value -> assigned token)
    const entityToToken = new Map<string, string>();
    const typeCounters: Record<string, number> = {};
    const tokens: PIITokenMap[] = [];

    // Assign tokens in reading order (ascending startIndex) for consistent numbering
    const matchesInOrder = [...nonOverlapping].sort((a, b) => a.startIndex - b.startIndex);

    for (const match of matchesInOrder) {
      const normalizedKey = `${match.type}:${match.value.trim().toLowerCase()}`;
      let assignedToken = entityToToken.get(normalizedKey);

      if (!assignedToken) {
        typeCounters[match.type] = (typeCounters[match.type] || 0) + 1;
        assignedToken = `[${match.type}_${typeCounters[match.type]}]`;
        entityToToken.set(normalizedKey, assignedToken);
      }

      tokens.push({
        token: assignedToken,
        type: match.type,
        originalValue: match.value,
        startIndex: match.startIndex,
        endIndex: match.endIndex
      });
    }

    // Sort descending by startIndex for safe Right-to-Left string substitution
    const rtlTokens = [...tokens].sort((a, b) => b.startIndex - a.startIndex);

    let sanitized = text;
    for (const item of rtlTokens) {
      sanitized =
        sanitized.substring(0, item.startIndex) +
        item.token +
        sanitized.substring(item.endIndex);
    }

    return {
      sanitizedText: sanitized,
      tokenCount: tokens.length,
      tokens, // In sequential order for audit and downstream processing
      timestamp: new Date().toISOString(),
      riskLevel: this.calculateRisk(tokens.length, tokens.map(t => t.type))
    };
  }

  /**
   * Priority-weighted overlap resolution:
   * Sorts matches primarily by priority ascending (1: SECRET_KEY before 6: PERSON),
   * secondarily by startIndex ascending, tertiarily by span length descending.
   * Iterates through candidates and greedily accepts candidate spans that do not
   * intersect any already-accepted span (candidate.startIndex < accepted.endIndex && candidate.endIndex > accepted.startIndex).
   * Finally, sorts accepted matches by startIndex ascending for deterministic Right-to-Left substitution.
   */
  public static resolveOverlaps(matches: RawMatch[]): RawMatch[] {
    if (matches.length <= 1) return matches;

    // Sort: 1) Priority ascending (1 to 6), 2) startIndex ascending, 3) span length descending
    const candidates = [...matches].sort((a, b) => {
      const prioDiff = CATEGORY_PRIORITY[a.type] - CATEGORY_PRIORITY[b.type];
      if (prioDiff !== 0) return prioDiff;
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
    });

    const accepted: RawMatch[] = [];

    for (const candidate of candidates) {
      // Check if candidate intersects with any already accepted span
      const hasOverlap = accepted.some(
        acc => candidate.startIndex < acc.endIndex && candidate.endIndex > acc.startIndex
      );

      if (!hasOverlap) {
        accepted.push(candidate);
      }
    }

    // Sort by startIndex ascending for reading order and subsequent RTL substitution
    return accepted.sort((a, b) => a.startIndex - b.startIndex);
  }

  private static calculateRisk(count: number, types: PIIType[]): 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' {
    if (count === 0) return 'NONE';
    if (types.includes('SECRET_KEY') || types.includes('IBAN')) return 'HIGH';
    if (count >= 3) return 'HIGH';
    if (count === 2) return 'MEDIUM';
    return 'LOW';
  }

  private static collectAllMatches(text: string): RawMatch[] {
    // Deterministic match collection across all 6 compiled RegExp patterns
    // ...
    return [];
  }
}
```

---

## 4. Recursive JSON Re-hydration Algorithm (Atomic Single-Pass Regex)

AI model inference returns a structured JSON payload conforming to `ExtractedTaskSchema`. This object contains the synthetic tokens injected during masking (e.g., `title: "Call [PERSON_1] regarding [AMOUNT_MONEY_1]"`).

### Security Vulnerabilities in Sequential Re-hydration:
Sequential iteration (`for (const [token, val] of tokenMap) { target = target.replaceAll(token, val); }`) introduces two severe security flaws:
1. **Token Boundary Collisions:** Replacing `[PERSON_1]` sequentially can corrupt `[PERSON_10]`, mutating it into `Alice Newman0`.
2. **Cascaded Token Injection:** If an `originalValue` itself contains bracketed text resembling a token (e.g., a note mentioning `[EMAIL_1]`), subsequent iterations will replace that user text with another token's value.

### Atomic Single-Pass Solution:
The Privacy Guard executes re-hydration via **atomic single-pass regular expression matching** (`TOKEN_PATTERN`). Every token boundary is evaluated exactly once in a single sweep:

```typescript
// Authoritative Token Pattern covering all 6 categories
export const TOKEN_PATTERN = /\[(?:SECRET_KEY|IBAN|EMAIL|PHONE|AMOUNT_MONEY|PERSON)_\d+\]/g;

/**
 * Recursively re-hydrates tokens in a parsed JSON structure using atomic single-pass regex replacement.
 * Accepts either an ephemeral Map<string, string> or an array of PIITokenMap records (e.g. from SanitizationResult.tokens).
 *
 * @param target Data structure returned from Gemini inference
 * @param tokenMapOrTokens Map linking token string (e.g. "[PERSON_1]") to cleartext original value OR array of PIITokenMap records
 */
export function rehydrate<T>(
  target: T,
  tokenMapOrTokens: Map<string, string> | PIITokenMap[]
): T {
  const tokenMap: Map<string, string> = Array.isArray(tokenMapOrTokens)
    ? new Map(tokenMapOrTokens.map(t => [t.token, t.originalValue]))
    : tokenMapOrTokens;

  // Base case 1: String primitive — atomic single-pass substitution
  if (typeof target === 'string') {
    return target.replace(TOKEN_PATTERN, (match) => {
      return tokenMap.get(match) ?? match;
    }) as unknown as T;
  }

  // Base case 2: Array elements — recursive mapping
  if (Array.isArray(target)) {
    return target.map(item => rehydrate(item, tokenMap)) as unknown as T;
  }

  // Base case 3: Nested object structures — recursive property walk
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

### Mandatory Acceptance Tests:

1. **Deterministic Roundtrip Invariance:**
   $$\forall \text{ text},\quad \text{rehydrate}(\text{mask}(\text{text}).\text{sanitizedText}, \text{tokenMap}) \equiv \text{text}$$
2. **Atomic Re-hydration & Prefix Collision Proof:**
   A string containing both `[PERSON_1]` and `[PERSON_10]` must re-hydrate to the distinct original names without `[PERSON_1]` mutating `[PERSON_10]`.
3. **Cascaded Injection Resistance:**
   If the original value of `[PERSON_1]` is literal text containing `[EMAIL_1]`, atomic re-hydration must output `[EMAIL_1]` without second-pass substitution.
4. **Unicode & International Person Name Recognition:**
   Names with umlauts, diacritics, and accents (`Jürgen Müller`, `Michał Kowalski`, `François Dupond`, `Søren Kierkegaard`) must be detected and masked cleanly.
5. **Entity Deduplication Invariance:**
   When `Alice Newman` appears 3 times in a single input, all 3 occurrences must map to `[PERSON_1]`, while preserving exact start/end replacement coordinates.
6. **Priority Overlap Resolution:**
   In compound strings where an API key or IBAN overlaps with an email or phone pattern, the higher-priority category must prevail (`SECRET_KEY` > `IBAN` > `EMAIL` > `PHONE` > `AMOUNT_MONEY` > `PERSON`).
7. **Punctuation Boundaries & Formatting:**
   Trailing periods, commas, and parentheses must not be swallowed into tokens.
8. **Coverage Guarantee:**
   Statements, branches, functions, and lines in `server/src/privacy/` must meet or exceed **95% coverage** as reported by `@vitest/coverage-v8`.
