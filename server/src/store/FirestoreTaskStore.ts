import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { TaskEntity, MemoEntity, PrivacyAuditLog } from '../types/contracts.js';
import { ITaskRepository } from './ITaskRepository.js';

export const COLLECTION_MEMOS = 'memos';
export const COLLECTION_TASKS = 'tasks';
export const COLLECTION_PRIVACY_AUDIT_LOGS = 'privacy_audit_logs';

export interface FirestoreTaskStoreOptions {
  firestore?: Firestore;
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
}

/**
 * Enterprise Google Cloud Firestore persistence implementation of ITaskRepository.
 * Manages collections for encrypted memos, tasks, and privacy audit logs.
 * Supports atomic transactional batch commits, credential certification, and local emulator integration.
 */
export class FirestoreTaskStore implements ITaskRepository {
  private readonly db: Firestore;

  /**
   * Initializes the FirestoreTaskStore with an injected Firestore instance or credentials.
   *
   * @param options Configuration options including custom Firestore instance or service credentials.
   */
  constructor(options?: FirestoreTaskStoreOptions) {
    if (options?.firestore) {
      this.db = options.firestore;
      return;
    }

    const apps = getApps();
    if (apps.length > 0 && !options?.clientEmail && !options?.privateKey && !options?.projectId) {
      this.db = getFirestore(apps[0] as App);
      return;
    }

    const projectId = options?.projectId ?? process.env.FIREBASE_PROJECT_ID ?? 'oscar-local';
    let app: App;

    if (options?.clientEmail && options?.privateKey) {
      const formattedKey = options.privateKey.includes('\\n')
        ? options.privateKey.replace(/\\n/g, '\n')
        : options.privateKey;
      const appName =
        apps.length > 0
          ? `oscar-cert-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
          : undefined;
      app = initializeApp(
        {
          credential: cert({
            projectId,
            clientEmail: options.clientEmail,
            privateKey: formattedKey,
          }),
          projectId,
        },
        appName,
      );
    } else if (process.env.FIRESTORE_EMULATOR_HOST) {
      const appName =
        apps.length > 0
          ? `oscar-emu-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
          : undefined;
      app = initializeApp({ projectId }, appName);
    } else {
      const appName =
        apps.length > 0
          ? `oscar-app-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
          : undefined;
      app = initializeApp(
        {
          credential: applicationDefault(),
          projectId,
        },
        appName,
      );
    }

    this.db = getFirestore(app);
  }

  /**
   * Retrieves all persisted tasks, sorted by creation date descending.
   *
   * @returns Array of encrypted TaskEntity documents.
   */
  public async getTasks(): Promise<TaskEntity[]> {
    const snapshot = await this.db.collection(COLLECTION_TASKS).get();
    const tasks: TaskEntity[] = [];
    snapshot.forEach((doc) => {
      tasks.push(doc.data() as TaskEntity);
    });
    return tasks.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * Retrieves a single encrypted task by its unique identifier.
   *
   * @param id Document identifier.
   * @returns Encrypted TaskEntity if found, undefined otherwise.
   */
  public async getTaskById(id: string): Promise<TaskEntity | undefined> {
    const doc = await this.db.collection(COLLECTION_TASKS).doc(id).get();
    if (!doc.exists) {
      return undefined;
    }
    return doc.data() as TaskEntity;
  }

  /**
   * Persists an encrypted TaskEntity document into Firestore.
   *
   * @param task Encrypted task entity.
   */
  public async addTask(task: TaskEntity): Promise<void> {
    await this.db.collection(COLLECTION_TASKS).doc(task.id).set(task);
  }

  /**
   * Updates an existing task with partial properties while maintaining updatedAt timestamps.
   *
   * @param id Unique task identifier.
   * @param updates Partial properties to merge.
   * @returns Updated TaskEntity if found, undefined otherwise.
   */
  public async updateTask(
    id: string,
    updates: Partial<TaskEntity>,
  ): Promise<TaskEntity | undefined> {
    const docRef = this.db.collection(COLLECTION_TASKS).doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return undefined;
    }
    const existing = doc.data() as TaskEntity;
    const updated: TaskEntity = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await docRef.set(updated);
    return updated;
  }

  /**
   * Removes a task document from Firestore by its unique identifier.
   *
   * @param id Task identifier to remove.
   * @returns True if the document was located and deleted, false otherwise.
   */
  public async deleteTask(id: string): Promise<boolean> {
    const docRef = this.db.collection(COLLECTION_TASKS).doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return false;
    }
    await docRef.delete();
    return true;
  }

  /**
   * Persists an encrypted MemoEntity document into Firestore.
   *
   * @param memo Encrypted memo entity.
   */
  public async addMemo(memo: MemoEntity): Promise<void> {
    await this.db.collection(COLLECTION_MEMOS).doc(memo.id).set(memo);
  }

  /**
   * Retrieves all persisted memos, sorted by creation date descending.
   *
   * @returns Array of encrypted MemoEntity documents.
   */
  public async getMemos(): Promise<MemoEntity[]> {
    const snapshot = await this.db.collection(COLLECTION_MEMOS).get();
    const memos: MemoEntity[] = [];
    snapshot.forEach((doc) => {
      memos.push(doc.data() as MemoEntity);
    });
    return memos.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * Atomically commits encrypted memo, task, and optional privacy audit log records in a single Firestore writeBatch.
   *
   * @param memo Encrypted memo entity.
   * @param task Encrypted task entity.
   * @param auditLog Optional privacy audit log.
   */
  public async commitBatch(
    memo: MemoEntity,
    task: TaskEntity,
    auditLog?: PrivacyAuditLog,
  ): Promise<void> {
    const batch = this.db.batch();
    batch.set(this.db.collection(COLLECTION_MEMOS).doc(memo.id), memo);
    batch.set(this.db.collection(COLLECTION_TASKS).doc(task.id), task);
    if (auditLog) {
      batch.set(this.db.collection(COLLECTION_PRIVACY_AUDIT_LOGS).doc(auditLog.id), auditLog);
    }
    await batch.commit();
  }

  /**
   * Purges all documents from memos, tasks, and privacy audit log collections.
   * Utilized for test teardown and ephemeral test suites.
   */
  public async clear(): Promise<void> {
    const collections = [COLLECTION_MEMOS, COLLECTION_TASKS, COLLECTION_PRIVACY_AUDIT_LOGS];
    for (const colName of collections) {
      const snapshot = await this.db.collection(colName).get();
      if (!snapshot.empty) {
        const batch = this.db.batch();
        snapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      }
    }
  }
}
