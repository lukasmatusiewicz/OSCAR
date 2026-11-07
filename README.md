# OSCAR — Orchestrated Secure Confidential Agent Runtime

> **An enterprise-grade, spec-driven personal assistant and multi-agent runtime featuring local PII masking, Zero Data Retention orchestration, client-side AES-256-GCM encryption at rest, and real-time reactive synchronization.**

[![CI / Vitest Pipeline](https://github.com/lukasmatusiewicz/OSCAR/actions/workflows/ci.yml/badge.svg)](https://github.com/lukasmatusiewicz/OSCAR/actions/workflows/ci.yml)
[![Tests Passing](https://img.shields.io/badge/Tests-108%20passed-brightgreen.svg)]()
[![Coverage](https://img.shields.io/badge/Coverage-100%25%20Lines%20%7C%2098.65%25%20Branches-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Methodology](https://img.shields.io/badge/Methodology-Spec--Driven%20Development-success.svg)](docs/spec/architecture.md)
[![AI Governance](https://img.shields.io/badge/Governance-PoLP%2C%20HITL%20%26%20Critic%20Gate-purple.svg)](docs/spec/multi-agent-system.md)

---

## 🌟 Core Highlights & Architectural Principles

* 🛡️ **Confidentiality by Design (Local PII Masking):** Automatically strips personally identifiable information (emails, names, monetary amounts, phone numbers, IBANs, API keys) locally before dispatching prompts to external LLMs.
* 🔐 **Client-Side AES-256-GCM Envelope Encryption:** Cleartext user data is never stored in public cloud storage. All sensitive fields are encrypted at rest using WebCrypto AES-256-GCM prior to Cloud Firestore persistence, with session key memory zeroing immediately upon request completion.
* 🤖 **Zero Data Retention Orchestration:** Built with the official Google GenAI SDK (`@google/genai`) and Gemini 2.5 Flash, enforcing strict JSON Schema runtime verification (`responseSchema`).
* ⏱️ **Gateway Resilience & SLA Protection:** Incorporates a 12 RPM token-bucket rate limiter (preventing upstream quota exhaustion), strict 8,000ms SLA timeout handler (`AbortSignal.timeout(8000)`), and an autonomous `DeterministicFallbackExtractor` rule engine for zero-data-loss offline operation.
* 📐 **Spec-Driven Development (SDD):** System specifications, runtime contracts, and verification criteria are authoritatively defined in `docs/spec/` before production code is committed, eliminating ad-hoc prompt coding.
* ⚡ **Real-Time Cross-Device Sync:** Built on Firebase Firestore (Spark Free Tier) leveraging direct `onSnapshot` listeners to push updates instantaneously to connected desktop and mobile clients.
* 🧪 **Deterministic Engineering Rigor:** 108 automated unit and integration tests passing across 5 test suites with 100% in-memory isolation (<2 seconds execution, zero live network calls in unit tests). Verified test coverage across all `server/src/**` modules: **100% Statements, 100% Functions, 100% Lines, and 98.65% Branches**.
* 🎨 **Client-Side Atomic Design:** React + TypeScript UI decoupled into isolated `atoms/`, `molecules/`, `organisms/`, and `views/` with scoped styling.
* 👥 **Maker-Checker-Critic Multi-Agent Governance:** Structured agentic workforce enforcing the Principle of Least Privilege (PoLP), Human-in-the-Loop (HITL) oversight, and an automated Architecture & Security Critic regression audit gate.

---

## 🏗️ Architecture at a Glance

```mermaid
flowchart LR
    Client["React UI (Atomic Design)\nWebCrypto AES-256-GCM"] -->|"1. Raw Input"| Gateway["Node.js / TS Gateway"]
    Gateway -->|"2. Mask PII"| PG["Privacy Guard Engine"]
    PG -->|"3. Sanitized XML Prompt"| AI["Google Gemini API (gemini-2.5-flash)"]
    AI -->|"4. Strict JSON"| PG
    PG -->|"5. Atomic Single-Pass Unmask"| Gateway
    Gateway -->|"6. AES-256-GCM Encrypt"| Storage[("Firebase Firestore\n(Encrypted at Rest)")]
    Storage -->|"7. Real-Time Stream (onSnapshot)"| Client
    Client -->|"8. Client-Side Decrypt"| Client
```

For full system diagrams, sequence workflows, and failure recovery protocols, see [**System Architecture Specification**](docs/spec/architecture.md).

---

## 📂 Project Structure

```
oscar/
├── docs/
│   └── spec/                          # Authoritative Specifications (Single Source of Truth)
│       ├── architecture.md            # System tiers, sequence flows, encryption, rate limits & Zero Trust
│       ├── contracts.md               # Authoritative Zod runtime schemas & JSON Schemas
│       ├── privacy-guard-spec.md      # PII detection rules, RTL substitution & atomic re-hydration
│       └── multi-agent-system.md      # Maker-Checker-Critic topology, PoLP matrix & Critic audit gate
├── client/                            # React + TypeScript + Vite (Atomic Design & WebCrypto)
│   └── src/
│       ├── components/
│       │   ├── atoms/                 # Single-purpose isolated UI components (scoped CSS)
│       │   ├── molecules/             # Grouped atom components
│       │   └── organisms/             # Business domain widgets
│       ├── views/                     # Page-level screens (Dashboard, TaskBoard)
│       └── services/                  # Gateway client & Firestore listeners
├── server/                            # Node.js + TypeScript Gateway
│   ├── src/
│   │   ├── privacy/                   # Pure Privacy Guard Engine (Masker / Re-hydrator)
│   │   ├── agent/                     # Gemini Orchestrator (@google/genai SDK)
│   │   ├── crypto/                    # AES-256-GCM Envelope Encryption & Key Zeroing
│   │   ├── fallback/                  # DeterministicFallbackExtractor (Rule Engine)
│   │   └── routes/                    # API endpoints & rate-limited gateway routes
│   └── tests/                         # Vitest test suite (108 tests, 100% lines, 98.65% branches)
├── .gitignore                         # Comprehensive ignore rules
├── LICENSE                            # MIT License (Statutory Copyright)
└── README.md                          # Project documentation portal
```

---

## 📋 Authoritative System Specifications

The OSCAR codebase strictly adheres to the following specification documents:

1. [**System Architecture**](docs/spec/architecture.md): Component breakdown, end-to-end data sequence diagrams, tier specifications, AES-256-GCM envelope encryption, rate limiting (12 RPM), `DeterministicFallbackExtractor`, and Zero Trust guarantees.
2. [**Domain & Data Contracts**](docs/spec/contracts.md): Authoritative Zod schemas for PII token maps, `EncryptedPayloadSchema`, Gemini structured task responses, Firestore entities (`MemoEntity`, `TaskEntity`), and privacy audit logs.
3. [**Privacy Guard Engine Specification**](docs/spec/privacy-guard-spec.md): ECMAScript regular expressions for 6 PII categories, Right-to-Left replacement algorithm, entity deduplication, priority overlap resolution, atomic single-pass regex re-hydration, and Vitest test criteria.
4. [**Multi-Agent System & Governance**](docs/spec/multi-agent-system.md): Agent topology (Lead Architect, Master Orchestrator, Docs Worker, Privacy Specialist, QA Auditor, Security Critic), Principle of Least Privilege (PoLP) matrix, Continuous Specification Regression Audit Gate, command execution allowlist, and Human-in-the-Loop (HITL) checkpoints.

---

## 🛡️ Privacy Guard: How It Works

1. **Detection:** Scans input for API keys, IBANs, email addresses, phone numbers, monetary values, and person names using prioritized ECMAScript RegExp matchers with Unicode property escapes (`\p{Lu}\p{Ll}+`).
2. **Priority Overlap Resolution & Deduplication:** Resolves overlapping spans by priority (`SECRET_KEY` > `IBAN` > `EMAIL` > `PHONE` > `AMOUNT_MONEY` > `PERSON`) and maps repeated entities to identical tokens (`[PERSON_1]`).
3. **Right-to-Left Masking:** Substitutes detected entities from end to start of the string, preserving character indices and preventing offset drift.
4. **Structured Inference:** Sends sanitized text inside `<user_memo>` boundaries to Google Gemini alongside strict `responseSchema`.
5. **Atomic Single-Pass Re-hydration:** Walks the returned JSON tree depth-first and restores cleartext values in a single atomic regex sweep, preventing token prefix collisions and cascaded injection.
6. **Zero Trace & Encryption at Rest:** The mapping dictionary is immediately garbage collected. The unmasked data is encrypted via AES-256-GCM before writing to Cloud Firestore, with key buffers wiped from memory.

---

## 🗺️ Roadmap & Implementation Status

- [x] **Phase 1: Architecture & Data Contracts**  
  *Authoritative Zod schemas, Spec-Driven Development blueprints, Principle of Least Privilege (PoLP) matrix, Human-in-the-Loop (HITL) protocols, Maker-Checker-Critic multi-agent architecture.*
- [x] **Phase 2: Privacy Guard Engine**  
  *Pure, deterministic PII detection for 6 categories, ECMAScript Unicode property escapes, priority-weighted greedy overlap resolution, entity deduplication, and atomic single-pass regex re-hydration. 36 unit tests passing with 100% coverage.*
- [x] **Phase 3: AI Orchestration & Gateway Resilience**  
  *Native `@google/genai` integration with Gemini 2.5 Flash, 12 RPM token-bucket rate limiter, 8,000ms SLA timeout handler, `DeterministicFallbackExtractor` rule engine, WebCrypto AES-256-GCM envelope encryption with session key memory zeroing, and full Zod runtime validation. 108 automated unit and integration tests passing across 5 test suites (100% Lines, 98.65% Branches).*
- [ ] **Phase 4: Client-Side UI & Real-Time Sync**  
  *React 18+ Vite TypeScript frontend, strict Atomic Design component hierarchy (`atoms/`, `molecules/`, `organisms/`, `views/`), client-side WebCrypto decryption, and Firebase Firestore real-time synchronization (`onSnapshot`).*

---

## 🚀 Getting Started

### Prerequisites
* **Node.js:** v20.x or higher (LTS recommended)
* **npm:** v10.x or higher
* **Google AI Studio API Key:** For external Gemini inference (free tier)

### Quickstart & Test Verification
Clone the repository, install dependencies in the `server` directory, and run the test suite:

```bash
# Navigate to the backend gateway
cd server

# Clean installation of dependencies
npm ci

# Run all 108 automated unit and integration tests
npm test

# Run the test suite with comprehensive coverage report
npm run test:coverage
```

### Environment Configuration
Create a local `.env` file in the `server/` directory:

```env
# Google AI Studio API Key (Gemini 2.5 Flash)
GEMINI_API_KEY=your_google_ai_studio_api_key_here

# Server Configuration
PORT=3000
NODE_ENV=development
```

> [!IMPORTANT]
> **Security Invariant:** The `.env` file contains sensitive operational credentials and is strictly excluded by `.gitignore`. It must **never** be committed to source control or exposed to the client application.

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
