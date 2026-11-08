import { useState, useCallback, useEffect, useRef } from 'react';
import { DecryptedTaskPayload, TaskEntity, TaskPriority, TaskStatus } from '../types/contracts';
import { ClientCryptoService } from '../services/ClientCryptoService';
import { gatewayClient } from '../services/GatewayClient';

/**
 * Custom hook for managing tasks, client-side decryption, and gateway synchronization.
 * Supports optimistic status/priority mutations with background gateway sync and offline fallback.
 *
 * @param initialTasks Optional list of initial TaskEntity records.
 */
export function useTasks(initialTasks: TaskEntity[] = []) {
  const [tasks, setTasks] = useState<TaskEntity[]>(initialTasks);
  const [decryptedPayloads, setDecryptedPayloads] = useState<Record<string, DecryptedTaskPayload>>(
    {},
  );
  const [isDecrypting, setIsDecrypting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const decryptTask = useCallback(
    async (task: TaskEntity): Promise<DecryptedTaskPayload | null> => {
      if (!ClientCryptoService.hasSessionKey()) {
        return null;
      }
      try {
        const decrypted = await ClientCryptoService.decrypt<DecryptedTaskPayload>(
          task.encryptedPayload,
        );
        return decrypted;
      } catch {
        return null;
      }
    },
    [],
  );

  const decryptAllTasks = useCallback(
    async (taskList: TaskEntity[]) => {
      if (!ClientCryptoService.hasSessionKey() || taskList.length === 0) {
        return;
      }
      setIsDecrypting(true);
      setError(null);
      try {
        const results: Record<string, DecryptedTaskPayload> = {};
        for (const t of taskList) {
          const decrypted = await decryptTask(t);
          if (decrypted) {
            results[t.id] = decrypted;
          }
        }
        if (isMountedRef.current) {
          setDecryptedPayloads((prev) => ({ ...prev, ...results }));
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
    },
    [decryptTask],
  );

  // Decrypt on tasks change or initial load
  useEffect(() => {
    decryptAllTasks(tasks);
  }, [tasks, decryptAllTasks]);

  /**
   * Fetches latest tasks from backend gateway with offline fallback.
   */
  const fetchTasks = useCallback(async () => {
    try {
      const remoteTasks = await gatewayClient.fetchTasks();
      if (isMountedRef.current) {
        setTasks(remoteTasks);
      }
    } catch {
      // Offline fallback: preserve current local tasks
    }
  }, []);

  const addTask = useCallback(
    (task: TaskEntity, decrypted?: DecryptedTaskPayload) => {
      setTasks((prev) => [task, ...prev]);
      if (decrypted) {
        setDecryptedPayloads((prev) => ({ ...prev, [task.id]: decrypted }));
      } else {
        decryptTask(task).then((res) => {
          if (res && isMountedRef.current) {
            setDecryptedPayloads((prev) => ({ ...prev, [task.id]: res }));
          }
        });
      }
    },
    [decryptTask],
  );

  const updateTaskStatus = useCallback((taskId: string, newStatus: TaskStatus) => {
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
    gatewayClient.updateTask(taskId, { status: newStatus }).catch(() => {
      // Keep optimistic state offline
    });
  }, []);

  const updateTaskPriority = useCallback((taskId: string, newPriority: TaskPriority) => {
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
    gatewayClient.updateTask(taskId, { priority: newPriority }).catch(() => {
      // Keep optimistic state offline
    });
  }, []);

  const deleteTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setDecryptedPayloads((prev) => {
      const copy = { ...prev };
      delete copy[taskId];
      return copy;
    });

    gatewayClient.deleteTask(taskId).catch(() => {
      // Keep optimistic deletion
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
      return {
        ...prev,
        [taskId]: {
          ...existing,
          subtasks: updatedSubtasks,
        },
      };
    });
  }, []);

  const updateTaskPayload = useCallback(
    (taskId: string, updatedPayload: DecryptedTaskPayload) => {
      setDecryptedPayloads((prev) => ({
        ...prev,
        [taskId]: updatedPayload,
      }));
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === taskId) {
            return {
              ...t,
              location: updatedPayload.location ?? t.location,
              contactPerson: updatedPayload.contactPerson ?? t.contactPerson,
              amount: updatedPayload.amount ?? t.amount,
              scheduledTime: updatedPayload.scheduledTime ?? t.scheduledTime,
              updatedAt: new Date().toISOString(),
            };
          }
          return t;
        }),
      );
    },
    [],
  );

  const clearDecryptedPayloads = useCallback(() => {
    setDecryptedPayloads({});
  }, []);

  const draftsCount = tasks.filter((t) => t.status === 'DRAFT').length;

  return {
    tasks,
    decryptedPayloads,
    isDecrypting,
    error,
    addTask,
    updateTaskStatus,
    updateTaskPriority,
    updateTaskPayload,
    deleteTask,
    fetchTasks,
    toggleSubtask,
    decryptAllTasks,
    clearDecryptedPayloads,
    draftsCount,
  };
}
