# OSCAR Privacy Guard Engine Specification

## 1. Purpose & Security Mandate
The **Privacy Guard Engine** is the foundational security boundary of OSCAR. It guarantees that sensitive personally identifiable information (PII) and credentials never leave the local application environment when prompts are transmitted to external AI providers.

The engine executes locally on the server gateway as a pure, deterministic, zero-network module.

---

## 2. Deterministic Algorithmic + Regex Multilingual Privacy Architecture

The Privacy Guard is a **deterministic algorithmic + regex NER engine** with multilingual (PL/DE/EN) morphological lemmatization, high-entropy checksum verification, and context-anchored proximity matchers, plus an optional Tier-2 ML extension point (`maskAsync`, currently unused in production routes):

```mermaid
flowchart TD
    Input["Confidential Text Input"] --> Split{"Deterministic 3-Tier Detection Pipeline"}
    
    subgraph Tier1["Tier 1: High-Entropy Deterministic & Checksum Regexes"]
        TK["SECRET_KEY (Weight: 60)<br/>API Keys, JWTs, Bearer, Cloud PATs"]
        TI["IBAN (Weight: 50)<br/>SEPA Bank Accounts (24-34 chars, Mod-97)"]
        TN["NATIONAL_ID (Weight: 45)<br/>PESEL (Checksum), Steuer-ID, US SSN"]
        TH["HEALTH_DATA (Weight: 40)<br/>German KVNR ([A-Z]\\d{9}), GDPR Art. 9"]
        TE["EMAIL (Weight: 35)<br/>RFC 5322 Standard Mailboxes"]
        TP["PHONE (Weight: 30)<br/>E.164 & National Phone Numbers"]
    end

    subgraph Tier2["Tier 2: Deterministic Linguistic & Morphological NER (PL/DE/EN)"]
        TR["PERSON (Weight: 20)<br/>Multilingual Names (Morphological Lemmatization across EN, PL, DE, FR)"]
        TA["ADDRESS (Weight: 15)<br/>Street Prefixes (ul., al., pl., rue, St., Straße) & International Cities"]
        Ext["Optional Tier-2 ML Extension Point (maskAsync)<br/>(Currently unused in production routes; falls back to deterministic engine)"]
    end

    subgraph Tier3["Tier 3: Context-Aware Generic Matcher"]
        TC["Contextual Card & Policy Scanner<br/>(6-16 alphanumeric chars near trigger words: karta, numer, polisa, ubezpieczenie, versichert, card, policy)"]
    end

    Split --> Tier1
    Split --> Tier2
    Split --> Tier3
    
    Tier1 --> Overlap["Priority Overlap Resolver<br/>(Descending Weight: 60 > 50 > 45 > 40 > 35 > 30 > 25 > 20 > 15)"]
    Tier2 --> Overlap
    Tier3 --> Overlap
    Overlap --> Dedupe["Cross-Entity Deduplication Map"]
    Dedupe --> RTL["Right-to-Left In-Place Masking"]
    RTL --> Output["Sanitized Payload + Ephemeral Token Dictionary"]
```

### 2.1 Architectural Tiers

#### Tier 1: High-Entropy Deterministic & Checksum Patterns
Tier 1 matches structured credentials and government-issued or banking identifiers where pattern entropy is high and false-positive rates are eliminated through algorithmic checksum verification:
- **Secret & API Keys (`SECRET_KEY`, Priority Weight: 60):** Identifies OAuth Bearer tokens, GitHub personal access tokens (`ghp_`), Google AI Studio credentials (`ai...`), OpenAI API keys (`sk-...`), and generic 20+ character high-entropy key strings.
- **Bank Account Numbers (`IBAN`, Priority Weight: 50):** Detects ISO 13616 International Bank Account Numbers across all SEPA jurisdictions (e.g., `DE`, `PL`, `FR`, `GB`, `CH`), verifying structure and optional grouping spaces with MOD-97 checksum validation.
- **National Identification Numbers (`NATIONAL_ID`, Priority Weight: 45):**
  - *Polish PESEL (11 digits):* Validated against the official statutory checksum formula:
    $$C = \left( 10 - \left( \sum_{i=1}^{10} w_i \cdot d_i \pmod{10} \right) \right) \pmod{10}$$
    using weight matrix $w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]$. Strings passing formatting but failing the checksum are discarded to prevent false positives.
  - *German Steuer-ID / IdNr (11 digits):* Matches 11-digit fiscal identifiers with structural validation ensuring digit non-random distribution (one digit repeated 2 or 3 times, remainder unique).
  - *US Social Security Numbers (SSN):* Matches standard `\b\d{3}-\d{2}-\d{4}\b` with non-zero group/serial validations.
- **Health Identifiers (`HEALTH_DATA`, Priority Weight: 40):**
  - *German Krankenversichertennummer (KVNR):* Matches 10-character health card identifiers `\b[A-Z]\d{9}\b` (1 uppercase alphanumeric character followed by 9 digits with Luhn Mod-10 checksum validation).
  - Governed under **GDPR Article 9 ("Processing of special categories of personal data")**: zero transmission to third-party LLMs.
- **Email Addresses (`EMAIL`, Priority Weight: 35):** Comprehensive RFC 5322 standard matching for personal and enterprise mailboxes.
- **Phone Numbers (`PHONE`, Priority Weight: 30):** International E.164 formats (`+49...`, `0048...`) and national telephone variants with area code parentheses, hyphens, and whitespace separators.

#### Tier 2: Deterministic Linguistic & Morphological NER (with Optional `maskAsync` ML Extension Point)
Tier 2 runs synchronously and deterministically in-memory within the Node.js process using **algorithmic + regex NER** and **multilingual (PL/DE/EN) morphological lemmatization** (`LinguisticNormalizer`), with **zero network calls**. An optional Tier-2 ML extension point (`maskAsync`) is exposed for future local NER model integration (currently unused in production routes):
- **Multilingual Person Names (`PERSON`, Priority Weight: 20):**
  - *Grammatical Inflection & Declined Cases:* Recognizes both nominative and inflected/declined case forms in inflected languages (e.g., Polish genitive/accusative/instrumental: *Jana Kowalskiego*, *Annie Nowak*, *Piotrem Wiśniewskim*; German dative/genitive; French accented names).
  - *Contextual Action Anchors:* Identifies names following relational prepositions and action verbs across English (`with`, `meeting`, `call`, `for`, `from`, `by`, `to`, `contact`, `assigned to`), Polish (`z`, `ze`, `spotkanie z`, `dla`, `od`), German (`mit`, `treffen mit`, `für`, `von`), and French (`avec`, `réunion avec`, `pour`, `de`).
  - *Honorific Titles:* Captures honorific prefixes: `Mr.`, `Ms.`, `Mrs.`, `Dr.`, `Prof.`, `Herr`, `Frau`, `Pan`, `Pani`, `M.`, `Mme.`
  - *Unicode Letter Properties:* Uses ECMAScript `\p{Lu}\p{Ll}+` with the `u` flag to preserve diacritics, accents, and umlauts across all European alphabets.
- **Address & Location Detection (`ADDRESS`, Priority Weight: 15):**
  - *International Cities & Urban Centers:* Deterministic city lexicon covering major business capitals and regional hubs (e.g., `New York`, `Kassel`, `Berlin`, `Paris`, `Warsaw`, `London`, `Zurich`, `Tokyo`, `Frankfurt`, `Munich`, `Vienna`, `Geneva`, `Brussels`, `Amsterdam`, `Krakow`, `Wrocław`, `Poznań`, `Gdańsk`).
  - *Street & Thoroughfare Prefixes:* Multi-language thoroughfare indicators (PL: `ul.`, `al.`, `pl.`; FR: `rue`, `avenue`, `bd`; EN: `St.`, `Street`, `Ave`, `Blvd`; DE: `Straße`, `Strasse`, `Str.`, `Weg`, `Platz`, `Gasse`).
- **Colloquial Monetary Amounts (`AMOUNT_MONEY`, Priority Weight: 25):**
  - *Multipliers & Magnitudes:* Captures shorthand numeric multipliers: `k`, `tys`, `tys.`, `mln`, `milionów`, `mld` (e.g., `50k`, `100 tys.`, `2.5 mln`, `10 milionów`).
  - *Currencies & Symbols:* Covers international currency ISO codes and symbols: `EUR`, `PLN`, `USD`, `CHF`, `zł`, `€`, `$`, `£`.
  - *Typo & Format Resilience:* Supports variations in whitespace, alternate thousand separators (dots, commas, non-breaking spaces), and flexible ordering (`50k zł`, `zł 50 000`, `1.5 mln EUR`, `100k USD`, `$450.00`).
- **Optional Tier-2 ML Extension Point (`maskAsync`):**
  - If an optional external/local ML NER provider is registered via `maskAsync` and fails to initialize, encounters a memory constraint, or exceeds its timeout budget, the system seamlessly falls back to the deterministic algorithmic + regex NER engine. Zero cleartext data is leaked.

#### Tier 3: Context-Aware Generic Matcher
Tier 3 serves as an adaptive safety net for unstandardized identifiers, policy numbers, and member IDs:
- **Proximity Window Evaluation:** Identifies 6–16 alphanumeric characters occurring within a window of $\pm 30$ characters of designated trigger keywords.
- **Multilingual Trigger Lexicon:**
  - Polish: *karta*, *numer*, *polisa*, *ubezpieczenie*, *dowód*, *recepta*
  - German: *versichert*, *karte*, *nummer*, *polizze*, *versicherung*, *krankenkasse*, *ausweis*
  - English: *card*, *policy*, *number*, *insurance*, *member*, *coverage*, *contract*, *id*
- **Categorization:** Candidate strings in insurance or medical contexts are classified as `HEALTH_DATA` (Weight: 40); strings in citizen, identity, or account contexts are classified as `NATIONAL_ID` (Weight: 45).

### 2.2 Priority Hierarchy & Weighting System

When candidate spans overlap, Privacy Guard resolves conflicts deterministically using the explicit descending weight hierarchy:

$$\text{Weight}(\text{SECRET\_KEY}: 60) > \text{Weight}(\text{IBAN}: 50) > \text{Weight}(\text{NATIONAL\_ID}: 45) > \text{Weight}(\text{HEALTH\_DATA}: 40) > \text{Weight}(\text{EMAIL}: 35) > \text{Weight}(\text{PHONE}: 30) > \text{Weight}(\text{AMOUNT\_MONEY}: 25) > \text{Weight}(\text{PERSON}: 20) > \text{Weight}(\text{ADDRESS}: 15)$$

All regular expressions adhere strictly to ECMAScript standard syntax. Explicit flags (`giu` or `gu`) are compiled programmatically—inline `(?i)` flag syntax is strictly forbidden to prevent fatal `SyntaxError` exceptions at runtime.

| Weight | PII Category | Token Identifier | RegExp Pattern (ECMAScript Subset) | Flags | Example Matches |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **60** | **SECRET_KEY** | `[SECRET_KEY_N]` | `\b(?:bearer\s+[a-z0-9_\-\.]{20,}\|ghp_[a-z0-9]{36}\|ai[a-z0-9_\-]{30,}\|sk-[a-z0-9]{32,})\b` | `giu` | `ghp_1234567890abcdef1234567890abcdef1234`, `Bearer eyJhbGciOi...` |
| **50** | **IBAN** | `[IBAN_N]` | `\b[A-Z]{2}[0-9]{2}(?:[ ]?[0-9]{4}){4,7}(?:[ ]?[0-9]{1,4})?\b` | `gu` | `DE89 3704 0044 0532 0130 00`, `PL61109010140000071219812874` |
| **45** | **NATIONAL_ID** | `[NATIONAL_ID_N]` | `\b\d{11}\b\|\b\d{3}-\d{2}-\d{4}\b` (with PESEL checksum / Steuer-ID validation) | `gu` | `90010112345` (valid PESEL), `03245678912` (Steuer-ID), `123-45-6789` (SSN) |
| **40** | **HEALTH_DATA** | `[HEALTH_DATA_N]` | `\b[A-Z]\d{9}\b` (KVNR Luhn check) \| Context card ID proximity | `gu` | `A123456789` (German KVNR), `polisa 83726194` |
| **35** | **EMAIL** | `[EMAIL_N]` | `\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b` | `giu` | `contact@example.com`, `user@domain.co.uk` |
| **30** | **PHONE** | `[PHONE_N]` | `(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b` | `gu` | `+49 170 1234567`, `(030) 9876-5432`, `+1-800-555-0199` |
| **25** | **AMOUNT_MONEY** | `[AMOUNT_MONEY_N]` | `(?:\$|€|£|\b(?:PLN|EUR|USD|CHF|zł))\s?\d+(?:[.,\s]\d+)*(?:\s?(?:k|tys\.?|mln|milionów|mld))?\|\b\d+(?:[.,\s]\d+)*(?:\s?(?:k|tys\.?|mln|milionów|mld))?\s?(?:€|\$|£|\b(?:PLN|EUR|USD|CHF|zł)\b)` | `giu` | `15000 EUR`, `$450.00`, `50k zł`, `1.5 mln EUR`, `25 tys. PLN` |
| **20** | **PERSON** | `[PERSON_N]` | `(?:\b(?:Herr|Frau|Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.|Pan|Pani|M\.|Mme\.)\s+\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)\|(?:(?<=\b(?:with\|meeting\|call\|for\|from\|by\|to\|contact\|assigned to\|z\|ze\|spotkanie z\|dla\|od\|mit\|treffen mit\|für\|von\|avec\|pour\|de)\s+)\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)+)` | `gu` | `Mr. John Doe`, `meeting Alice Newman`, `call Jürgen Müller`, `z Janem Kowalskim`, `mit Hans Schmidt` |
| **15** | **ADDRESS** | `[ADDRESS_N]` | `(?:\b(?:ul\.|ulica|al\.|aleja|pl\.|plac|rue|avenue|bd|boulevard|chemin|St\.|Street|Ave|Avenue|Rd|Road|Blvd|Straße|Strasse|Str\.|Weg|Platz|Gasse)\s+\p{Lu}\p{Ll}+(?:\s+\p{Lu}?\p{Ll}+)*(?:\s+\d+[a-zA-Z]?(?:[/-]\d+)?)?)\|\b(?:New York|Kassel|Berlin|Paris|Warsaw|London|Zurich|Tokyo|Frankfurt|Munich|Vienna|Geneva|Brussels|Amsterdam|Krakow|Wrocław|Poznań|Gdańsk)\b` | `giu` | `ul. Marszałkowska 126`, `Friedrichstraße 43`, `rue de Rivoli 14`, `New York`, `Kassel`, `Berlin` |

> [!NOTE]
> **Markdown Table Syntax Note:** Alternation pipes within the regex table are escaped with a backslash (`\|`) to prevent breaking Markdown table delimiters. In TypeScript code, use unescaped standard alternation pipes (`|`).

---

## 3. Masking Algorithm (Right-to-Left Substitution with Deduplication)

When replacing multiple substrings within a single text, replacing from left to right causes index shifts: modifying an earlier slice invalidates character offsets of every subsequent match.

To preserve absolute index validity without costly string rebuilds, the Privacy Guard:
1. Scans all candidate matches across Tier 1, Tier 2, and Tier 3.
2. Resolves overlapping candidate spans using the **Priority Hierarchy** (higher weight wins: $60 \to 15$).
3. Deduplicates identical entity occurrences using a normalized entity-to-token map (`entityToToken: Map<string, string>`) so repeated entities receive identical tokens (`[PERSON_1]`, `[ADDRESS_1]`, `[NATIONAL_ID_1]`).
4. Sorts all resolved match instances in **descending order by `startIndex`** (Right-to-Left).
5. Slices and substitutes each token from back to front.

```mermaid
flowchart TD
    Raw["Raw Text Input"] --> Scan["Execute 3-Tier Multi-Category Matchers"]
    Scan --> Collect["Collect All Raw Matches (startIndex, endIndex, value, type)"]
    Collect --> Overlap["Priority-Weighted Overlap Resolution (60: SECRET_KEY -> 15: ADDRESS)"]
    Overlap --> Dedupe["Entity Deduplication (Normalize & Map repeated entities to same token)"]
    Dedupe --> Sort["Sort Descending by startIndex (Right-to-Left)"]
    Sort --> Splice["Splice Substrings from End to Beginning"]
    Splice --> Out["Emit SanitizedResult (sanitizedText, ephemeral tokenMap, riskLevel)"]
```

### TypeScript Implementation Blueprint:

```typescript
import { PIITokenMap, PIIType, SanitizationResult, RiskLevel } from '../types/contracts';

interface RawMatch {
  type: PIIType;
  value: string;
  startIndex: number;
  endIndex: number;
}

export const CATEGORY_PRIORITY: Record<PIIType, number> = {
  SECRET_KEY: 60,
  IBAN: 50,
  NATIONAL_ID: 45,
  HEALTH_DATA: 40,
  EMAIL: 35,
  PHONE: 30,
  AMOUNT_MONEY: 25,
  PERSON: 20,
  ADDRESS: 15,
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
        endIndex: match.endIndex,
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
      riskLevel: this.calculateRisk(tokens.length, tokens.map((t) => t.type)),
    };
  }

  /**
   * Priority-weighted overlap resolution:
   * Sorts matches primarily by weight descending (60: SECRET_KEY down to 15: ADDRESS),
   * secondarily by startIndex ascending, tertiarily by span length descending.
   * Iterates through candidates and greedily accepts candidate spans that do not
   * intersect any already-accepted span (candidate.startIndex < accepted.endIndex && candidate.endIndex > accepted.startIndex).
   * Finally, sorts accepted matches by startIndex ascending for deterministic Right-to-Left substitution.
   */
  public static resolveOverlaps(matches: RawMatch[]): RawMatch[] {
    if (matches.length <= 1) return matches;

    // Sort: 1) Priority weight descending (60 to 15), 2) startIndex ascending, 3) span length descending
    const candidates = [...matches].sort((a, b) => {
      const prioDiff = CATEGORY_PRIORITY[b.type] - CATEGORY_PRIORITY[a.type];
      if (prioDiff !== 0) return prioDiff;
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
    });

    const accepted: RawMatch[] = [];

    for (const candidate of candidates) {
      // Check if candidate intersects with any already accepted span
      const hasOverlap = accepted.some(
        (acc) => candidate.startIndex < acc.endIndex && candidate.endIndex > acc.startIndex,
      );

      if (!hasOverlap) {
        accepted.push(candidate);
      }
    }

    // Sort by startIndex ascending for reading order and subsequent RTL substitution
    return accepted.sort((a, b) => a.startIndex - b.startIndex);
  }

  public static calculateRisk(count: number, types: PIIType[]): RiskLevel {
    if (count === 0) return 'NONE';
    if (
      types.includes('SECRET_KEY') ||
      types.includes('IBAN') ||
      types.includes('NATIONAL_ID') ||
      types.includes('HEALTH_DATA')
    ) return 'HIGH';
    if (count >= 3) return 'HIGH';
    if (count === 2) return 'MEDIUM';
    return 'LOW';
  }

  private static collectAllMatches(text: string): RawMatch[] {
    // Deterministic match collection across all 9 compiled RegExp patterns and Tier 2/3 detectors
    // ...
    return [];
  }
}
```

---

## 4. Recursive JSON Re-hydration Algorithm (Atomic Single-Pass Regex)

AI model inference returns a structured JSON payload conforming to `ExtractedTaskSchema`. This object contains the synthetic tokens injected during masking (e.g., `title: "Call [PERSON_1] regarding [AMOUNT_MONEY_1] at [ADDRESS_1]"`).

### 4.1 Invariance of Token Re-hydration

The re-hydration process guarantees mathematical and structural roundtrip invariance:

1. **Deterministic Reverse-Replacement Invariance:**
   $$\forall \text{ text } T,\quad \text{rehydrate}(\text{mask}(T).\text{sanitizedText}, \text{tokens}) \equiv T$$
   Every byte sequence redacted during the sanitization phase is deterministically restored to its original cleartext counterpart without loss or deviation.

2. **Atomic Single-Pass Invariance:**
   Re-hydration evaluates every token match in an atomic single sweep using `TOKEN_PATTERN`. This guarantees that:
   - **Prefix Collision Immunity:** `[ADDRESS_1]` can never collide with or partially corrupt `[ADDRESS_10]`.
   - **Cascaded Token Injection Immunity:** If an entity's `originalValue` contains literal text mimicking a synthetic token (e.g., notes mentioning `[EMAIL_1]`), it cannot trigger a secondary substitution because replacement is strictly single-pass.

```typescript
// Authoritative Token Pattern covering all 9 categories
export const TOKEN_PATTERN =
  /\[(?:SECRET_KEY|IBAN|NATIONAL_ID|HEALTH_DATA|EMAIL|PHONE|AMOUNT_MONEY|PERSON|ADDRESS)_\d+\]/g;

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
    ? new Map(tokenMapOrTokens.map((t) => [t.token, t.originalValue]))
    : tokenMapOrTokens;

  // Base case 1: String primitive — atomic single-pass substitution
  if (typeof target === 'string') {
    const pattern = new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags);
    return target.replace(pattern, (match) => {
      return tokenMap.get(match) ?? match;
    }) as unknown as T;
  }

  // Base case 2: Array elements — recursive mapping
  if (Array.isArray(target)) {
    return target.map((item) => rehydrate(item, tokenMap)) as unknown as T;
  }

  // Base case 3: Nested object structures — recursive property walk
  if (target !== null && typeof target === 'object') {
    if (target instanceof Date) {
      return target;
    }
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

### 4.2 Smart Task Metadata Re-hydration & Synthesized Semantic Title Invariant

1. **Synthesized Semantic Title Invariant:**
   - Tasks emitted by the inference pipeline must ALWAYS possess an active, concise semantic title (e.g., "Schedule medical checkup with Dr. Weber", "Process payment for 50k zł").
   - Raw substrings, informal salutations ("Hey Lukas..."), or conversational fragments are strictly forbidden from serving as task titles.
   - Masked titles are bound to $\le 120$ characters; post-rehydration expanded bounds allow $\le 250$ characters to absorb lengthened entities.

2. **Recursive Traversal of Smart Task Metadata:**
   - The `rehydrate<T>()` function recursively descends into structured task objects:
     * `target.title`: String re-hydrated in-place.
     * `target.summary`: Paragraph text re-hydrated in-place.
     * `target.subtasks`: Array of checklist objects re-hydrated in-place.
     * `target.location`: Nullable venue or city string re-hydrated in-place (e.g. `"[ADDRESS_1]" -> "Berlin"`).
     * `target.contactPerson`: Nullable contact string re-hydrated in-place (e.g. `"[PERSON_1]" -> "Anna Nowak"`).
     * `target.amount`: Nullable currency string re-hydrated in-place (e.g. `"[AMOUNT_MONEY_1]" -> "1,500 EUR"`).
     * `target.scheduledTime`: Nullable colloquial time string re-hydrated in-place (e.g. `"tomorrow at 14:00"`).
   - Any synthetic token present in any metadata field is replaced in an atomic single sweep with zero risk of cascading token injection.

---

## 5. Test Suite & Acceptance Criteria (Vitest Target: >= 95% Coverage)

The test suite located at `server/tests/privacy/PrivacyGuard.spec.ts` must execute against **Vitest** with 100% in-memory isolation (no network, no disk, execution time < 50ms).

### Mandatory Acceptance Tests:

1. **Deterministic Roundtrip Invariance:**
   $$\forall \text{ text},\quad \text{rehydrate}(\text{mask}(\text{text}).\text{sanitizedText}, \text{tokenMap}) \equiv \text{text}$$
2. **Atomic Re-hydration & Prefix Collision Proof:**
   A string containing both `[ADDRESS_1]` and `[ADDRESS_10]` must re-hydrate to their distinct original addresses without prefix mutation.
3. **Cascaded Injection Resistance:**
   If the original value of `[PERSON_1]` contains bracketed text resembling a token (`[EMAIL_1]`), atomic single-pass re-hydration must preserve `[EMAIL_1]` without second-pass substitution.
4. **Multilingual Person Name Recognition & Declension:**
   Names across Polish, German, French, and English in both nominative and declined forms (`Jürgen Müller`, `Janem Kowalskim`, `Annie Nowak`, `François Dupond`) must be detected and masked cleanly.
5. **Colloquial Amounts & Multipliers:**
   Amounts with multipliers (`50k zł`, `1.5 mln EUR`, `25 tys. PLN`, `100 USD`) must be recognized and sanitized as `[AMOUNT_MONEY_N]`.
6. **Address & City Recognition:**
   Physical locations with street prefixes (`ul. Marszałkowska 126`, `Friedrichstraße 43`, `rue de Rivoli 14`) and major international urban hubs (`New York`, `Kassel`, `Berlin`, `Warsaw`, `London`) must be identified and masked as `[ADDRESS_N]`.
7. **Algorithmic PESEL & National ID Checksum Tests:**
   Valid 11-digit PESEL strings must be masked as `[NATIONAL_ID_N]`; random 11-digit numbers with invalid checksums must be rejected. Valid German Steuer-ID and US SSN (`\d{3}-\d{2}-\d{4}`) must be masked as `[NATIONAL_ID_N]`.
8. **German KVNR & Health Data Masking:**
   German health insurance numbers matching `\b[A-Z]\d{9}\b` must be classified and masked under `[HEALTH_DATA_N]` with high-risk designation.
9. **Tier 3 Context-Aware Generic Matcher:**
   Alphanumeric card or policy IDs of 6–16 characters within proximity (±30 characters) of keywords (*polisa*, *karta*, *ubezpieczenie*, *versichert*, *insurance*, *card*) must be masked under `[HEALTH_DATA_N]` or `[NATIONAL_ID_N]`.
10. **Optional Tier-2 ML Extension (`maskAsync`) Fallback:**
    When an optional Tier-2 ML provider registered via `maskAsync` is unavailable or times out, Privacy Guard falls back to the deterministic algorithmic + regex NER engine with 0% data leakage.
11. **Smart Task Metadata Re-hydration:**
    Synthetic tokens placed within `location`, `contactPerson`, `amount`, and `scheduledTime` must be cleanly and atomically re-hydrated to their original cleartext values.
12. **Entity Deduplication Invariance:**
    When an address, name, or ID appears multiple times in a single text, all occurrences must map to the same token index while preserving start/end coordinates.
13. **Priority Overlap Resolution Hierarchy:**
    In compound strings with intersecting candidates, the hierarchy strictly enforces:
    `SECRET_KEY (60) > IBAN (50) > NATIONAL_ID (45) > HEALTH_DATA (40) > EMAIL (35) > PHONE (30) > AMOUNT_MONEY (25) > PERSON (20) > ADDRESS (15)`.
14. **Punctuation Boundaries & Formatting:**
    Trailing periods, commas, and parentheses must not be swallowed into tokens.
15. **Coverage Guarantee:**
    Statements, branches, functions, and lines in `server/src/privacy/` must meet or exceed **95% coverage** as reported by `@vitest/coverage-v8`.
