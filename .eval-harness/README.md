# OSCAR Isolated Adversarial Holdout Evaluation Harness

## Purpose & Anti-Test-Gaming Principle

The `.eval-harness/` directory contains independent **adversarial holdout tests** written directly against the authoritative specifications in `docs/spec/` (`privacy-guard-spec.md`, `contracts.md`, `architecture.md`, and `multi-agent-system.md`).

Unlike standard unit and integration tests maintained by Maker agents alongside implementation code, holdout specs are authored independently to falsify assumptions, probe boundary and evasion conditions, and verify security invariants without mirroring internal implementation shortcuts or bugs.

## Physical Isolation

This harness is intentionally isolated from the application build and standard test graphs:

- **Test Runners:** `server/vitest.config.ts` (`tests/**/*.spec.ts`) and `client/` Vitest configurations exclude `.eval-harness/`.
- **TypeScript & Vite Build Graphs:** `server/tsconfig.json`, `client/tsconfig.json`, and `client/vite.config.ts` do not include `.eval-harness/`.
- **Coverage Accounting:** Holdout tests do not inflate Maker unit test counts or coverage percentages.

## Running the Holdout Suite

From the repository root:

```bash
npm run eval:holdout
```

## Suites

- `privacyGuard.holdout.spec.ts`: Stress-tests `PrivacyGuard` and `LinguisticNormalizer` against zero-width/format character (`\p{Cf}`) evasion, Unicode NFKC/NFD normalization bypasses, fullwidth ASCII, multi-part and declined PL/DE/EN hyphenated names, ISO 13616 MOD-97 IBAN and PESEL/SSN checksum falsification, and runtime-constructed credential/secret patterns.
- `cryptoAndStorage.holdout.spec.ts`: Stress-tests `EncryptionService` AES-256-GCM integrity (ciphertext, authTag, and IV tampering, wrong-key decryption, invalid key formats/lengths, ephemeral key buffer zeroing on normal and throwing paths) and zero-plaintext-at-rest enforcement across `TaskEntitySchema` and `FirestoreTaskStore`.
- `fallbackAndTemporal.holdout.spec.ts`: Stress-tests `DeterministicFallbackExtractor`, `TemporalResolver`, and `LinguisticNormalizer` against multilingual command-prefix stripping, PII token preservation, metadata bullet deduplication, leap-year and year-boundary date resolution, time-vs-currency/percentage traps, and `TEMPORAL_STOP_WORDS` boundary enforcement.
