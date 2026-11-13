# OSCAR Holistic Release Audit Checklist

This document defines the mandatory **7-Area Holistic Release Audit** process for OSCAR (Orchestrated Secure Confidential Agent Runtime).

## Trigger Rule

Run cross-model or independent Checker subagents against this checklist **before**:
- **Major releases** (e.g., `v1.0.0`, `v2.0.0`), or
- **Architectural shifts** (authentication, cryptography, key management, privacy masking engine, or persistence model changes).

> [!NOTE]
> Do **not** run the full holistic audit on every minor PR or routine bugfix. Standard CI gates (lint, typecheck, unit/E2E suites, and build verification) govern day-to-day PRs.

---

## 7-Area Holistic Audit Checklist

### 1. Crypto & Auth Reality
- [ ] **Key Lifecycle**: Verify AES-256-GCM session keys are generated client-side, transmitted only via `X-Oscar-Encryption-Key`, and zeroed in `finally` blocks (`EncryptionService.zeroKey`) after every cryptographic operation.
- [ ] **Key Management & Dev Fallback Policy**: Confirm `OSCAR_MASTER_KEY` is required in production (`NODE_ENV=production`) with zero hardcoded production keys; verify any ephemeral/dev-only fallback key behavior is strictly gated to non-production environments and never logs raw key material.
- [ ] **Auth & CORS Boundaries**: Verify strict CORS origin enforcement, `401` on missing session keys, `400` (`InvalidKeyError`) on malformed keys, `422` (`DecryptionError` / `DECRYPTION_FAILED`) on tampered/wrong-key decryption failures, and least-privilege route access.
- [ ] **Secrets Scan & GitHub Push Protection**: Confirm zero API keys, service account credentials, or `.env` secrets are committed to Git history or bundled into client build artifacts. Synthetic secret tokens in tests (e.g., AWS/Slack/JWT fixtures) MUST be constructed via runtime string concatenation (e.g., `'AKIA' + '...'` or `'xoxb-' + '...'`) so GitHub Push Protection secret scanning never blocks legitimate test suites.

### 2. Adversarial Privacy Probes
- [ ] **Multilingual & Unicode Normalization**: Test `PrivacyGuard` against NFKC-normalized homoglyphs, diacritics, zero-width joiners, and non-ASCII separators across supported jurisdictions (EN, DE, PL).
- [ ] **ReDoS Resilience**: Verify all regex patterns in `PrivacyGuard` and `LinguisticNormalizer` execute in bounded linear time on adversarial/long inputs without catastrophic backtracking.
- [ ] **Gemini & Log Trace Audit**: Confirm outbound Gemini prompts contain only synthetic tokens (`[PERSON_1]`, `[EMAIL_1]`, etc.) wrapped in `<user_memo>` delimiters, and that structured server logs contain zero raw PII or cleartext memo content.

### 3. README / Spec Parity
- [ ] **Status Codes & Schemas**: Verify `docs/spec/openapi.yaml` matches Express route implementations (e.g., `POST /api/memos` returns `201 Created`, error responses match `ValidationError` / `ServerError` schemas).
- [ ] **Verified Metrics**: Ensure test counts, coverage figures, and supported features in `README.md` and `docs/spec/` match actual command outputs.
- [ ] **Links & Quickstart**: Validate all internal documentation links, CLI commands, and local/Docker quickstart steps against a clean environment.

### 4. Mutation & Weak-Test Check
- [ ] **Route Decryption Verification**: Confirm tests actually decrypt persisted `encryptedPayload` blobs with the client key to verify round-trip integrity rather than asserting only HTTP status codes.
- [ ] **Error-Path Cleanup**: Verify failed requests (validation errors, AI timeouts, store failures) do not leave partial state in `TaskStore` and still zeroize ephemeral key buffers.
- [ ] **Holdout Adversarial Tests**: Run out-of-sample PII edge cases and tampered-ciphertext (`authTag` / bit-flip) tests to ensure strict `422`/decryption failure without silent fallback.

### 5. Startup & Failure-Mode Resilience
- [ ] **Fail-Fast Credential Probes**: Verify server startup validates required runtime configuration and fails fast with actionable diagnostics when critical dependencies are misconfigured.
- [ ] **Process Handlers**: Confirm graceful shutdown on `SIGINT`/`SIGTERM` and unhandled rejection/exception logging without leaking PII.
- [ ] **4xx / 5xx Mapping**: Verify Zod validation errors and `InvalidKeyError` map to `400`, `DecryptionError` to `422`, payload size limits to `413`, unsupported media types to `415`, missing keys to `401`, and unexpected errors to sanitized `500` responses.

### 6. Frontend Error / Offline UX
- [ ] **Key Loss Messaging**: Verify clear user guidance when the client-side session encryption key is missing, cleared, or rotated.
- [ ] **Loading & Error States**: Confirm all async operations (memo ingestion, task updates, deletions) expose accessible loading indicators and recoverable error banners.
- [ ] **Accessibility & Offline Fallback**: Verify keyboard navigation, ARIA labels/roles, color contrast, a single authoritative `manifest.webmanifest`, and the `Simulate Offline` toggle + in-memory deterministic fallback behavior (no Service Worker required).

### 7. CI/CD & Hygiene
- [ ] **Workflow Hardening**: Confirm `.github/workflows/ci.yml` enforces least-privilege `permissions: { contents: read }`, `concurrency` cancellation, and explicit `timeout-minutes` on every job.
- [ ] **Coverage Gates & Engines**: Verify Vitest coverage thresholds and consistent `"engines": { "node": ">=20.6.0" }` across root, `server/`, and `client/` `package.json` files.
- [ ] **Lockfiles & No Duplicate Specs**: Confirm `package-lock.json` files are up to date and no duplicate test suites (e.g., root `tests/e2e/`) or redundant manifests (`manifest.json`) exist.
- [ ] **Atomic Commits & Zero-File-Touch Governance**: Verify all PR commits are atomic Conventional Commits (`feat(...)`, `docs(...)`, `chore(...)`, etc.) and that the Master Orchestrator maintained Zero-File-Touch boundaries (delegating code/doc edits to PoLP-scoped subagents).
