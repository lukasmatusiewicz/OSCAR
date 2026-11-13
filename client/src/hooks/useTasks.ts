import { useState, useCallback, useEffect, useRef } from 'react';
import { DecryptedTaskPayload, TaskEntity, TaskPriority, TaskStatus } from '../types/contracts';
import { ClientCryptoService } from '../services/ClientCryptoService';
import { gatewayClient } from '../services/GatewayClient';
import { logger } from '../utils/logger';

/**
 * Custom hook for managing tasks, client-side decryption, and gateway synchronization.
 * Supports optimistic status/priority mutations with background gateway sync,
 * per-task undecryptable state tracking, and surfaced fetch/sync errors.
 *
 * @param initialTasks Optional list of initial TaskEntity records.
 */
export function useTasks(initialTasks: TaskEntity[] = []) {
  const [tasks, setTasks] = useState<TaskEntity[]>(initialTasks);
  const [decryptedPayloads, setDecryptedPayloads] = useState<Record<string, DecryptedTaskPayload>>(
    {},
  );
  const [undecryptableIds, setUndecryptableIds] = useState<Record<string, boolean>>({});
  const [isDecrypting, setIsDecrypting] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [unsyncedIds, setUnsyncedIds] = useState<Record<string, boolean>>({});
  const [syncError, setSyncError] = useState<string | null>(null);

  const decryptedPayloadsRef = useRef<Record<string, DecryptedTaskPayload>>({});
  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const markUnsynced = useCallback((taskId: string, err: unknown, fallbackMessage: string) => {
    if (!isMountedRef.current) return;
    const msg = err instanceof Error ? err.message : fallbackMessage;
    logger.warn('useTasks', `Sync failed for task ${taskId}: ${msg}`);
    setUnsyncedIds((prev) => ({ ...prev, [taskId]: true }));
    setSyncError(msg);
  }, []);

  const clearUnsynced = useCallback((taskId: string) => {
    if (!isMountedRef.current) return;
    setUnsyncedIds((prev) => {
      if (!prev[taskId]) return prev;
      const copy = { ...prev };
      delete copy[taskId];
      return copy;
    });
  }, []);

  const decryptAllTasks = useCallback(async (taskList: TaskEntity[]) => {
    if (!ClientCryptoService.hasSessionKey()) {
      if (isMountedRef.current) {
        setUndecryptableIds({});
      }
      return;
    }
    if (taskList.length === 0) {
      if (isMountedRef.current) {
        setUndecryptableIds({});
      }
      return;
    }

    setIsDecrypting(true);
    setError(null);
    try {
      const results: Record<string, DecryptedTaskPayload> = {};
      const nextUndecryptable: Record<string, boolean> = {};

      for (const t of taskList) {
        if (decryptedPayloadsRef.current[t.id]) {
          continue;
        }
        try {
          const decrypted = await ClientCryptoService.decrypt<DecryptedTaskPayload>(
            t.encryptedPayload,
          );
          results[t.id] = decrypted;
        } catch {
          nextUndecryptable[t.id] = true;
        }
      }

      if (isMountedRef.current) {
        if (Object.keys(results).length > 0) {
          const merged = { ...decryptedPayloadsRef.current, ...results };
          decryptedPayloadsRef.current = merged;
          setDecryptedPayloads(merged);
        }
        setUndecryptableIds(nextUndecryptable);
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Error decrypting tasks');
      }
    } finally {
      if (isMountedRef.current) {
        setIsDecrypting(false);
      }
    }
  }, []);

  // Decrypt on tasks change or initial load
  useEffect(() => {
    decryptAllTasks(tasks);
  }, [tasks, decryptAllTasks]);

  /**
   * Fetches latest tasks from backend gateway, surfacing loading and error state.
   */
  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const remoteTasks = await gatewayClient.fetchTasks();
      if (isMountedRef.current) {
        setTasks(remoteTasks);
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch tasks from gateway';
        logger.warn('useTasks', `fetchTasks failed: ${msg}`);
        setFetchError(msg);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const addTask = useCallback((task: TaskEntity, decrypted?: DecryptedTaskPayload) => {
    logger.info('useTasks', `Added task ${task.id} (status: ${task.status}, priority: ${task.priority})`);
    if (decrypted) {
      decryptedPayloadsRef.current = { ...decryptedPayloadsRef.current, [task.id]: decrypted };
      setDecryptedPayloads(decryptedPayloadsRef.current);
      setUndecryptableIds((prev) => {
        if (!prev[task.id]) return prev;
        const copy = { ...prev };
        delete copy[task.id];
        return copy;
      });
    } else if (ClientCryptoService.hasSessionKey()) {
      ClientCryptoService.decrypt<DecryptedTaskPayload>(task.encryptedPayload)
        .then((res) => {
          if (isMountedRef.current) {
            decryptedPayloadsRef.current = { ...decryptedPayloadsRef.current, [task.id]: res };
            setDecryptedPayloads(decryptedPayloadsRef.current);
            setUndecryptableIds((prev) => {
              if (!prev[task.id]) return prev;
              const copy = { ...prev };
              delete copy[task.id];
              return copy;
            });
          }
        })
        .catch(() => {
          if (isMountedRef.current && ClientCryptoService.hasSessionKey()) {
            setUndecryptableIds((prev) => ({ ...prev, [task.id]: true }));
          }
        });
    }
    setTasks((prev) => [task, ...prev]);
  }, []);

  const updateTaskStatus = useCallback(
    (taskId: string, newStatus: TaskStatus) => {
      logger.info('useTasks', `Updated task ${taskId} status -> ${newStatus}`);
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === taskId) {
            return {
              ...t,
              status: newStatus,
              updatedAt: new Date().toISOString(),
            };
          }
          return t;
        }),
      );

      // Optimistic background sync with gateway
      gatewayClient
        .updateTask(taskId, { status: newStatus })
        .then(() => clearUnsynced(taskId))
        .catch((err: unknown) => markUnsynced(taskId, err, 'Failed to sync task status'));
    },
    [clearUnsynced, markUnsynced],
  );

  const updateTaskPriority = useCallback(
    (taskId: string, newPriority: TaskPriority) => {
      logger.info('useTasks', `Updated task ${taskId} priority -> ${newPriority}`);
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === taskId) {
            return {
              ...t,
              priority: newPriority,
              updatedAt: new Date().toISOString(),
            };
          }
          return t;
        }),
      );

      // Optimistic background sync with gateway
      gatewayClient
        .updateTask(taskId, { priority: newPriority })
        .then(() => clearUnsynced(taskId))
        .catch((err: unknown) => markUnsynced(taskId, err, 'Failed to sync task priority'));
    },
    [clearUnsynced, markUnsynced],
  );

  const deleteTask = useCallback((taskId: string) => {
    logger.info('useTasks', `Deleted task ${taskId}`);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    const copy = { ...decryptedPayloadsRef.current };
    delete copy[taskId];
    decryptedPayloadsRef.current = copy;
    setDecryptedPayloads(copy);

    setUndecryptableIds((prev) => {
      if (!prev[taskId]) return prev;
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    setUnsyncedIds((prev) => {
      if (!prev[taskId]) return prev;
      const next = { ...prev };
      delete next[taskId];
      return next;
    });

    gatewayClient.deleteTask(taskId).catch((err: unknown) => {
      if (isMountedRef.current) {
        const msg = err instanceof Error ? err.message : 'Failed to delete task on gateway';
        logger.warn('useTasks', `deleteTask sync failed for ${taskId}: ${msg}`);
        setSyncError(msg);
      }
    });
  }, []);

  const toggleSubtask = useCallback((taskId: string, subtaskIndex: number, completed: boolean) => {
    setDecryptedPayloads((prev) => {
      const existing = prev[taskId];
      if (!existing || !existing.subtasks || !existing.subtasks[subtaskIndex]) {
        return prev;
      }
      const updatedSubtasks = existing.subtasks.map((st, i) =>
        i === subtaskIndex ? { ...st, completed } : st,
      );
      const next = {
        ...prev,
        [taskId]: {
          ...existing,
          subtasks: updatedSubtasks,
        },
      };
      decryptedPayloadsRef.current = next;
      return next;
    });
  }, []);

  const updateTaskPayload = useCallback(
    (taskId: string, updatedPayload: DecryptedTaskPayload) => {
      logger.info('useTasks', `Updating task payload for ${taskId}`);
      decryptedPayloadsRef.current = {
        ...decryptedPayloadsRef.current,
        [taskId]: updatedPayload,
      };
      setDecryptedPayloads(decryptedPayloadsRef.current);
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === taskId) {
            return {
              ...t,
              scheduledTime: updatedPayload.scheduledTime ?? t.scheduledTime,
              scheduledDate:
                updatedPayload.scheduledDate !== undefined
                  ? updatedPayload.scheduledDate
                  : t.scheduledDate,
              updatedAt: new Date().toISOString(),
            };
          }
          return t;
        }),
      );

      // Re-encrypt updated payload with session key and dispatch to gateway
      (async () => {
        if (ClientCryptoService.hasSessionKey()) {
          try {
            const newEncryptedPayload = await ClientCryptoService.encrypt(updatedPayload);
            if (isMountedRef.current) {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId ? { ...t, encryptedPayload: newEncryptedPayload } : t,
                ),
              );
            }
          } catch {
            // Keep existing encryption
          }
        }

        gatewayClient
          .patchTask(taskId, {
            title: updatedPayload.title,
            summary: updatedPayload.summary,
            subtasks: updatedPayload.subtasks,
            location: updatedPayload.location,
            contactPerson: updatedPayload.contactPerson,
            amount: updatedPayload.amount,
            scheduledTime: updatedPayload.scheduledTime,
            scheduledDate: updatedPayload.scheduledDate,
          })
          .then(() => clearUnsynced(taskId))
          .catch((err: unknown) => markUnsynced(taskId, err, 'Failed to sync task update'));
      })();
    },
    [clearUnsynced, markUnsynced],
  );

  const clearDecryptedPayloads = useCallback(() => {
    decryptedPayloadsRef.current = {};
    setDecryptedPayloads({});
    setUndecryptableIds({});
  }, []);

  const clearSyncError = useCallback(() => {
    setSyncError(null);
  }, []);

  const draftsCount = tasks.filter((t) => t.status === 'DRAFT').length;

  return {
    tasks,
    decryptedPayloads,
    undecryptableIds,
    isDecrypting,
    isLoading,
    error,
    fetchError,
    unsyncedIds,
    syncError,
    addTask,
    updateTaskStatus,
    updateTaskPriority,
    updateTaskPayload,
    deleteTask,
    fetchTasks,
    toggleSubtask,
    decryptAllTasks,
    clearDecryptedPayloads,
    clearSyncError,
    draftsCount,
  };
}
