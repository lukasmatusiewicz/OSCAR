# OSCAR — Orchestrated Secure Confidential Agent Runtime

> **A single-user confidential task assistant prototype exploring a spec-driven, multi-agent workflow, featuring local PII masking, Gemini structured-output extraction with a deterministic offline fallback, AES-256-GCM encryption at rest (per-request session key over TLS), and an installable PWA manifest.**

[![Release](https://img.shields.io/badge/Release-v1.0.0-blue.svg)](package.json)
[![Architecture](https://img.shields.io/badge/Architecture-Spec--Driven-0A66C2.svg)](docs/spec/architecture.md)
[![Testing](https://img.shields.io/badge/Testing-608%2F608%20Passing%20(100%25)-brightgreen.svg)](#verification--metrics)
[![Coverage](https://img.shields.io/badge/Coverage-Server%2095.27%25%20br.%20%7C%20Client%2090.87%25%20br.-brightgreen.svg)](#verification--metrics)
[![Regulatory](https://img.shields.io/badge/Regulatory-EU%20AI%20Act%20Art.%2013%20Provenance%20Fields-purple.svg)](docs/spec/multi-agent-system.md)
[![PWA](https://img.shields.io/badge/PWA-Installable%20Manifest-success.svg)](client/public/manifest.webmanifest)
[![CI / Vitest Pipeline](https://github.com/lukasmatusiewicz/OSCAR/actions/workflows/ci.yml/badge.svg)](https://github.com/lukasmatusiewicz/OSCAR/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7%2B%20Strict-3178C6.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Development Workflow

OSCAR is an experiment and ongoing engineering effort **towards a spec-driven, multi-agent workflow**, where specifications precede code, scoped Maker subagents work within Principle of Least Privilege (PoLP) boundaries, and independent Checkers verify deliverables before a human Supervisor reviews and merges atomic PRs:

```mermaid
flowchart LR
    SPEC["1. Spec\n(docs/spec/ & Zod)"] --> ORCH["2. Master Orchestrator\n(Dispatcher Only)"]
    ORCH --> MAKER["3. Scoped Maker Subagent\n(PoLP Boundaries)"]
    MAKER --> GATES["4. Automated Checks\n(Vitest + ESLint + tsc)"]
    GATES --> CHECKER["5. Independent Checker /\nSpec & Code Audit"]
    CHECKER --> PR["6. Atomic Git PR\n(Conventional Commits)"]
    PR --> HUMAN["7. Human Supervisor Merge\n(Protected main)"]
```

### Repository Layers
1. **Specifications & Contracts (`docs/spec/`):** OpenAPI 3.1, Zod schemas, PII masking rules, and system architecture.
2. **Application Runtimes (`server/` & `client/`):** Express 5 gateway and React 18 Vite PWA implementing the contracts.
3. **Automated Verification (`server/tests/` & `client/tests/`):** 608 unit, integration, adversarial, and DOM privacy tests.
4. **Agent Governance (`docs/spec/multi-agent-system.md` & `docs/spec/release-audit-checklist.md`):** Maker-Checker-Critic roles, pre-edit auditors, and release audit checklist.

---

## Overview

OSCAR (**Orchestrated Secure Confidential Agent Runtime**) is a single-user prototype/showcase that masks sensitive PII locally before sending memos to a cloud LLM, then rehydrates extracted tasks and stores encrypted payloads at rest.

### 1. Privacy Guard & Encryption
* **Encryption at Rest (Session Key over TLS):** AES-256-GCM encryption at rest with a per-request 256-bit session key generated in-memory on the client (`crypto.getRandomValues`) and supplied over TLS, using random 96-bit IVs and 128-bit authentication tags. Server-side memory zeroing (`Buffer.fill(0)`) is applied as best-effort cleanup on key buffers (subject to JS runtime/GC semantics).
* **Multilingual Deterministic NER `PrivacyGuard`:** Deterministic algorithmic + regex NER heuristics combining regex scanners (`SECRET_KEY`, `IBAN`, `EMAIL`, `PHONE`, `AMOUNT_MONEY`, `NATIONAL_ID`, `ADDRESS`, `HEALTH_DATA`) with multilingual (PL/DE/EN) morphological lemmatization (`LinguisticNormalizer`), temporal boundary protection (`TemporalResolver`), deterministic token mapping (`{{PERSON_1}}` / `[PERSON_1]`, `{{PHONE_1}}` / `[PHONE_1]`, `{{EMAIL_1}}` / `[EMAIL_1]`), and an optional Tier-2 ML extension point (`maskAsync`, currently unused in production routes).

### 2. Gemini 2.5 Flash Gateway & Fallback Extractor
* **Structured Output Cloud Inference:** Built on the official Google GenAI SDK (`@google/genai`) targeting `gemini-2.5-flash` with JSON Schema output (`responseSchema`) and `<user_memo>` XML prompt-injection sandboxing.
* **Runtime Zod Validation & Deterministic Fallback:** API payloads and model outputs are validated with Zod contracts. When Gemini is unavailable, rate-limited (global 12-RPM token-bucket limiter), or times out (`8,000ms` `AbortSignal.timeout(8000)`), `DeterministicFallbackExtractor` executes in `< 5ms` to extract tasks locally.

### 3. Metadata Separation & Firestore Persistence
* **Encrypted Payload Storage:** Sensitive task fields (`title`, `summary`, `subtasks`, `location`, `contactPerson`, `amount`, `scheduledTime`) and raw memo contents are stored as `AES-256-GCM` encrypted blobs (`EncryptedPayload`, with `sanitizedContentPreview` omitted at rest on `MemoEntity`). Non-PII operational metadata (`category`, `priority`, `status`, `scheduledDate`, `provenance`, `tags`) remains queryable.
* **Atomic `writeBatch` Mutations & CRUD Lifecycle:** `FirestoreTaskStore` uses `GoogleAuth`, startup `verifyConnection()` diagnostics, and Firestore atomic batch commits (`writeBatch`), with an automatic in-memory repository fallback (`TaskStore`) for local development without Firebase credentials. Supports the task lifecycle: **Draft -> Confirm -> Inline Edit -> Complete -> Delete**.

### 4. Structured Telemetry
* **Zero-PII Logging:** Structured JSON and console telemetry across both client and server (`debug`, `info`, `warn`, `error`) with correlation IDs and latency instrumentation, avoiding raw PII or key material in log outputs.

### 5. Responsive UI & PWA Manifest
* **Mobile-First Atomic Design:** Built down to `360px` viewports with a responsive CSS grid, high-contrast light slate UI, segmented nav switcher (`Intake` / `Task Board`), `PrivacyAuditPanel` (`Simulate Offline` demo switch + Lock/Init Key control), undecryptable/sync-error banners, installable PWA manifest (`manifest.webmanifest`) + `InstallPrompt`, and 1-click **RFC 5545-style `.ics` iCalendar export** (without 75-octet line folding) for scheduled tasks.

---

## Known Limitations & Roadmap

### What Works Today
* **Single-User Prototype/Showcase:** Runs locally with the in-memory `TaskStore` or against Google Cloud Firestore.
* **Automated Test Suite:** 608 passing tests across 46 suites (376 server, 232 client).
* **AES-256-GCM Encryption at Rest:** Per-request 256-bit session key supplied over TLS with 96-bit IVs and 128-bit auth tags.
* **Deterministic NER & Offline Fallback:** Algorithmic + regex NER heuristics (PL/DE/EN) and `< 5ms` `DeterministicFallbackExtractor` when Gemini is unreachable or omitted.
* **Demo Controls & PWA Manifest:** `Simulate Offline` demo switch in `PrivacyAuditPanel` and an installable `manifest.webmanifest`.

### Roadmap (Future Goals)
* **Multi-Tenant Authentication (v2.0):** User accounts, authentication, and per-tenant data isolation are not yet implemented.
* **Client-Side E2EE / Passphrase-Derived Keys (v2.0):** The 256-bit session key is currently ephemeral in-memory and lost on page reload (`F5`), so tasks encrypted in a prior session cannot be decrypted after reload until passphrase-derived keys / auth are added.
* **Service Worker Asset Caching:** The PWA manifest is installable, but Service Worker offline asset caching is not yet implemented.
* **Isolated Holdout Test Harness:** All 608 tests live in the main repository; a separate holdout evaluation harness remains a future goal.

---

## Architecture

### End-to-End Sequence & Data Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as User (Voice / Text Memo)
    participant UI as React 18 PWA Client<br/>(WebCrypto + Local Shield)
    participant GW as Express 5 Gateway<br/>(RateLimiter + Zod Guard)
    participant PG as PrivacyGuard Engine<br/>(Deterministic NER + Lemmatizer)
    participant AI as Gemini 2.5 Flash<br/>(or <5ms DeterministicFallbackExtractor)
    participant Crypto as AES-256-GCM Engine<br/>(Envelope Encryption)
    participant DB as Cloud Firestore<br/>(Atomic writeBatch)

    User->>UI: Input Multilingual Voice/Text Memo
    UI->>UI: Real-time Client Privacy Shield Preview ({{PERSON_1}}, {{EMAIL_1}})
    UI->>GW: POST /api/memos (X-Oscar-Encryption-Key Header)
    GW->>PG: mask(rawText) — Priority Overlap Resolution & RTL Substitution
    PG-->>GW: Sanitized Text + Ephemeral In-Memory Vault Map
    GW->>AI: Dispatch Sanitized Prompt (<user_memo>) + Strict JSON Schema
    alt Gemini 2.5 Flash Available (< 8000ms SLA)
        AI-->>GW: Structured Task Array (provenance: GEMINI_FLASH)
    else Quota Exhausted / Offline / Timeout
        AI-->>GW: DeterministicFallbackExtractor (< 5ms, provenance: DETERMINISTIC_FALLBACK)
    end
    GW->>PG: rehydrate(extractedTasks, vaultMap) — Single-Pass Atomic Unmask
    PG-->>GW: Cleartext Structured Tasks (In-Memory Only)
    GW->>Crypto: Encrypt Sensitive Payload (AES-256-GCM, 96-bit IV, 128-bit AuthTag)
    Crypto-->>GW: EncryptedPayload + Best-Effort Key Buffer Zeroing (.fill(0))
    GW->>DB: Atomic writeBatch Commit (MemoEntity + TaskEntities)
    DB-->>UI: 201 Created (Encrypted Tasks + PII Audit Telemetry)
```

### Pipeline Overview

```text
+---------------------------------------------------------------------------------------------------+
|                           OSCAR CONFIDENTIAL INTAKE PIPELINE (v1.0.0)                             |
+---------------------------------------------------------------------------------------------------+

  [1. Voice / Text Memo]
         │  "Meeting with John Doe (john@company.com, +49 600100200) tomorrow at 14:00. Note: 25 000 EUR"
         ▼
  [2. Local PrivacyGuard NER Masking & Morphological Lemmatization (PL / DE / EN)]
         │  ├── Priority Overlap Resolution: SECRET_KEY > IBAN > EMAIL > PHONE > AMOUNT > PERSON
         │  ├── Temporal Boundary Guard: Protects dates/times ("tomorrow at 14:00") from false NER capture
         │  └── Ephemeral Token Vault: [PERSON_1], [EMAIL_1], [PHONE_1], [AMOUNT_MONEY_1]
         ▼
  [3. Sanitized Cloud Prompt (<user_memo> XML Sandbox)]
         │  "Meeting with [PERSON_1] ([EMAIL_1], [PHONE_1]) tomorrow at 14:00. Note: [AMOUNT_MONEY_1]"
         ▼
  [4. Gemini 2.5 Flash Orchestrator  ───(8000ms timeout / error ─► <5ms Extractor)───►  DeterministicFallbackExtractor]
         │  ├── Strict JSON Schema (responseSchema) + Runtime Zod Contract Validation
         │  └── Multi-Intent Task Decomposition + EU AI Act Art. 13 Provenance Fields
         ▼
  [5. Local PII Rehydration & AES-256-GCM Envelope Encryption]
         │  ├── Depth-First Single-Pass Atomic Regex Unmasking
         │  ├── WebCrypto / Node Crypto AES-256-GCM (256-bit ephemeral session key, 12-byte IV, 16-byte AuthTag)
         │  └── Ephemeral Vault Garbage-Collected & Best-Effort Key Buffer Zeroing (.fill(0))
         ▼
  [6. Google Cloud Firestore Atomic Batch Commit]
         ├── Ciphertext Blob: { ciphertext, iv, authTag, keyId } (Zero Cleartext PII at Rest)
         └── Queryable Metadata: { category, priority, status: "DRAFT", provenance, scheduledDate, tags }
```

---

## Verification & Metrics

OSCAR v1.0.0 currently passes **608 automated tests across 46 test suites (100% pass rate)** with measured branch coverage (`server`: **376 tests / 19 suites** @ `95.27%` branch, `99.07%` lines/statements; `client`: **232 tests / 27 suites** @ `90.87%` branch, `97.61%` lines/statements), zero ESLint warnings/errors, and strict TypeScript compilation (`noImplicitAny`, `strictNullChecks`).

| Verification Tier | Workspace | Test Suites | Passing Tests | Coverage Gate / Measured | Key Assurance Domains |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Backend Unit, API & Adversarial** | `server` | 19 | 376 | `>= 95%` Gate (`95.27%` br., `99.07%` lines/stmts) | Deterministic NER `PrivacyGuard`, `LinguisticNormalizer` (PL/DE/EN), `TemporalResolver`, `EncryptionService` (AES-256-GCM & best-effort memory zeroing), `GeminiOrchestrator`, `DeterministicFallbackExtractor`, `RateLimiter`, `FirestoreTaskStore` (`GoogleAuth` + `verifyConnection()`), `/api/memos`, `/api/tasks`, `/api/health`, `/api/docs`, chaotic multilingual & E2E suites |
| **Frontend Atomic UI, Hooks & Security** | `client` | 27 | 232 | `>= 90%` Gate (`90.87%` br., `97.61%` lines/stmts) | Atomic Design hierarchy (`atoms`, `molecules`, `organisms`, `views`), `ClientCryptoService` (WebCrypto ephemeral 256-bit session key + AES-GCM), `clientPiiMasker.ts`, `GatewayClient`, `PrivacyAuditPanel`, RFC 5545-style `.ics` Calendar Export, PWA `InstallPrompt`, `zeroPiiLeakage.test.tsx` |
| **Static Analysis & Types** | `root` | — | **0 Errors / 0 Warnings** | **Strict TS** | ESLint (`@typescript-eslint`) + TypeScript 5.7 (`tsc --noEmit` & `vite build`) |
| **TOTAL VERIFIED** | **All** | **46 Suites** | **608 / 608 (100%)** | **Server 95.27% br. / 99.07% lines \| Client 90.87% br. / 97.61% lines** | **v1.0.0 Baseline** |

---

## Project Structure

```text
oscar/
├── docs/
│   └── spec/                          # Specifications & Architecture Docs
│       ├── architecture.md            # System tiers, sequence flows, encryption, and rate limits
│       ├── contracts.md               # Zod runtime schemas & JSON Schemas
│       ├── multi-agent-system.md      # Maker-Checker-Critic topology, PoLP matrix & 8 Pillars
│       ├── openapi.yaml               # OpenAPI 3.1.0 Gateway specification (v1.0.0)
│       ├── privacy-guard-spec.md      # PII detection rules, RTL substitution & atomic re-hydration
│       └── release-audit-checklist.md # 7-Area Release Audit Checklist
├── client/                            # React 18 + TypeScript + Vite PWA (27 suites, 232 tests)
│   ├── public/
│   │   ├── manifest.webmanifest       # Web App Manifest & icons
│   │   ├── icon-192.png / icon-512.png
│   │   └── icon-192.svg / icon-512.svg
│   ├── src/
│   │   ├── components/
│   │   │   ├── atoms/                 # Badge, Button, Input, InstallPrompt, PrivacyShieldBadge
│   │   │   ├── molecules/             # CategoryBadge, PrioritySelector, SearchBox, TokenPreviewBadge
│   │   │   └── organisms/             # MemoEditor, PrivacyAuditPanel, TaskCard, TaskList
│   │   ├── hooks/                     # useTasks, useMemos, usePrivacyShield
│   │   ├── services/                  # ClientCryptoService (WebCrypto), GatewayClient
│   │   ├── types/
│   │   │   └── contracts.ts           # Frontend domain & API type contracts
│   │   ├── utils/                     # calendarExport (.ics), clientPiiMasker.ts, linguisticNormalizer, temporalResolver, logger
│   │   └── views/                     # Dashboard, TaskBoard
│   └── tests/                         # Vitest + React Testing Library + Zero-PII DOM Security Suite
├── server/                            # Node.js + Express 5 + TypeScript Gateway (19 suites, 376 tests)
│   ├── src/
│   │   ├── app.ts                     # Express 5 application factory & middleware wiring
│   │   ├── agent/                     # GeminiOrchestrator (@google/genai), DeterministicFallbackExtractor, TemporalResolver
│   │   ├── gateway/                   # Token-bucket RateLimiter (12 RPM)
│   │   ├── middleware/                # Defensive errorHandler (zero stack-trace / PII leakage)
│   │   ├── privacy/                   # PrivacyGuard (Deterministic Algorithmic + Regex NER), LinguisticNormalizer
│   │   ├── routes/                    # memos, tasks, health, docs (OpenAPI / Scalar viewer)
│   │   ├── security/                  # EncryptionService (AES-256-GCM), requestKey derivation
│   │   ├── store/                     # ITaskRepository, FirestoreTaskStore (GoogleAuth + verifyConnection + writeBatch), TaskStore (In-Memory)
│   │   ├── types/
│   │   │   └── contracts.ts           # Backend Zod runtime contracts
│   │   └── utils/                     # Structured logger
│   └── tests/                         # Unit, Route Integration, Chaotic Multilingual & E2E Test Suites
├── .env.example                       # Sanitized environment configuration template
├── firebase.json                      # Firebase Hosting & SPA rewrite configuration
├── package.json                       # Workspace root orchestrator (v1.0.0)
└── README.md                          # Project overview, architecture, and quickstart
```

---

## Quickstart

### Prerequisites
* **Node.js:** `>= 20.6.0` LTS (required by `tsx --env-file`; v20.6+, v22, or v24 recommended)
* **npm:** `>= 10.0.0`
* **Google Gemini API Key *(Optional)*:** Obtainable from [Google AI Studio](https://aistudio.google.com/app/apikey). If omitted, OSCAR automatically operates using the built-in `< 5ms` `DeterministicFallbackExtractor` rule engine.
* **Google Cloud Firestore *(Optional)*:** If `FIREBASE_PROJECT_ID` / credentials are omitted, the server automatically falls back to the in-memory `TaskStore`.

### 1. Installation & Environment Setup

```bash
# Clone the repository and enter the workspace
git clone https://github.com/lukasmatusiewicz/OSCAR.git
cd OSCAR/oscar

# Install dependencies across root, server, and client
npm install
npm --prefix server install
npm --prefix client install

# Copy the sanitized environment template
cp .env.example server/.env
```

Edit `server/.env` as needed (all fields have safe local defaults; `FIREBASE_*` and `FIRESTORE_EMULATOR_HOST` are optional when using the in-memory `TaskStore` fallback):

```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info
# Optional Firestore / Emulator configuration:
# FIREBASE_PROJECT_ID=your_project_id
# FIRESTORE_EMULATOR_HOST=localhost:8080
```

Optionally configure client-side logging in `client/.env`:

```env
VITE_LOG_LEVEL=info
```

> [!IMPORTANT]
> **Security Invariant:** `.gitignore` blocks all `.env*` files (except `.env.example`), `*credentials*.json`, `*service-account*.json`, and `*firebase-adminsdk*.json`. Never commit live API keys or service account keys to version control.

### 2. Start Development Servers

Launch both the Express 5 Gateway (`http://localhost:3000`) and the React 18 Vite PWA (`http://localhost:5173`) concurrently with color-coded streaming logs:

```bash
npm run dev
```

* **Frontend Application:** `http://localhost:5173`
* **Interactive OpenAPI 3.1 Docs (Scalar UI):** `http://localhost:3000/api/docs`
* **Raw OpenAPI 3.1 YAML Specification:** `http://localhost:3000/api/docs/openapi.yaml`
* **Gateway Health Probe:** `http://localhost:3000/api/health`

### 3. Running Tests, Linting & Production Builds

```bash
# Run all 608 automated tests across server (376) and client (232)
npm test

# Run server or client test suites individually
npm --prefix server test
npm --prefix client test

# Run full test coverage reports (V8 coverage provider)
npm run test:coverage

# Run full-stack End-to-End (E2E) test suites
npm run test:e2e

# Verify zero ESLint errors/warnings across both workspaces
npm run lint

# Compile TypeScript and build production bundles
npm run build
```

### 4. PWA Installation Instructions

OSCAR includes a Web App Manifest ([`manifest.webmanifest`](client/public/manifest.webmanifest)) and an in-app installation banner ([`InstallPrompt.tsx`](client/src/components/atoms/InstallPrompt.tsx)):

* **Desktop (Chrome / Edge / Brave):** Open `http://localhost:5173` (or the deployed HTTPS URL). Click the **"Install App"** button in the OSCAR top bar or the browser address bar install icon to launch OSCAR in a standalone window.
* **iOS (Safari) & Android (Chrome):** Tap the browser **Share** menu (iOS) or **More Options** menu (Android) and select **"Add to Home Screen"**. OSCAR launches in `standalone` display mode without browser chrome.

---

## Specification Index

OSCAR follows **Spec-Driven Development (SDD)**—architectural boundaries, threat models, and data contracts are documented in `docs/spec/`:

* [**System Architecture Specification (`docs/spec/architecture.md`)**](docs/spec/architecture.md) — Tier architecture, end-to-end confidential sequences, AES-256-GCM envelope encryption, 12 RPM rate limiting, and fallback resilience.
* [**Privacy Guard Specification (`docs/spec/privacy-guard-spec.md`)**](docs/spec/privacy-guard-spec.md) — Deterministic algorithmic & regex NER PII detection, priority overlap resolution, Right-to-Left span substitution, atomic single-pass rehydration, and zero-leakage guarantees.
* [**OpenAPI 3.1 Gateway Contract (`docs/spec/openapi.yaml`)**](docs/spec/openapi.yaml) — REST API specification for `/api/memos`, `/api/tasks`, `/api/health`, and `/api/docs` (`v1.0.0`).
* [**Domain & Data Schema Contracts (`docs/spec/contracts.md`)**](docs/spec/contracts.md) — Zod schemas, `EncryptedPayload`, `TaskEntity`, `MemoEntity`, and GDPR/EU AI Act provenance models.
* [**Multi-Agent System & 8 Pillars of Craftsmanship (`docs/spec/multi-agent-system.md`)**](docs/spec/multi-agent-system.md) — Maker-Checker-Critic topology, Principle of Least Privilege (PoLP) matrix, Human-in-the-Loop (HITL) checkpoints, mandatory Pre-Edit Auditors, Documentation Tone Standard, and Pillar 8 Structured Telemetry.
* [**Release Audit Checklist (`docs/spec/release-audit-checklist.md`)**](docs/spec/release-audit-checklist.md) — 7-Area Release Audit gate covering Crypto & Auth, Adversarial Privacy Probes, Spec Parity, Mutation Checks, Resilience, Offline UX, and CI Hygiene.

---

## License

This project is licensed under the [MIT License](LICENSE).
