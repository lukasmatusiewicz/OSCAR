import { vi } from 'vitest';

interface MockApp {
  name: string;
  options?: unknown;
}

const mockApps: MockApp[] = [];

const mockDb = {
  collection: vi.fn(),
  batch: vi.fn(),
};

class QueryDocumentSnapshot {}
class DocumentData {}

vi.mock('firebase-admin', () => ({
  default: {
    get apps() {
      return [...mockApps];
    },
    initializeApp: vi.fn((options?: unknown, name?: string) => {
      const app: MockApp = { name: name ?? '[DEFAULT]', options };
      mockApps.push(app);
      return app;
    }),
    credential: {
      cert: vi.fn(),
      applicationDefault: vi.fn(),
    },
  },
  get apps() {
    return [...mockApps];
  },
  initializeApp: vi.fn((options?: unknown, name?: string) => {
    const app: MockApp = { name: name ?? '[DEFAULT]', options };
    mockApps.push(app);
    return app;
  }),
  credential: {
    cert: vi.fn(),
    applicationDefault: vi.fn(),
  },
}));

vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => [...mockApps]),
  initializeApp: vi.fn((options?: unknown, name?: string) => {
    const app: MockApp = { name: name ?? '[DEFAULT]', options };
    mockApps.push(app);
    return app;
  }),
  deleteApp: vi.fn(async (app: unknown) => {
    const index = mockApps.findIndex((a) => a === app || a.name === (app as MockApp)?.name);
    if (index !== -1) {
      mockApps.splice(index, 1);
    }
  }),
  cert: vi.fn(),
  applicationDefault: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => {
  return {
    getFirestore: vi.fn(() => mockDb),
    Firestore: vi.fn(() => mockDb),
    QueryDocumentSnapshot,
    DocumentData,
  };
});
