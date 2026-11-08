import { useState, useCallback, useEffect } from 'react';
import {
  DecryptedTaskPayload,
  TaskEntity,
  TaskPriority,
  TaskStatus
} from '../types/contracts';
import { ClientCryptoService } from '../services/ClientCryptoService';

export function useTasks(initialTasks: TaskEntity[] = []) {
  const [tasks, setTasks] = useState<TaskEntity[]>(initialTasks);
  const [decryptedPayloads, setDecryptedPayloads] = useState<Record<string, DecryptedTaskPayload>>({});
  const [isDecrypting, setIsDecrypting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const decryptTask = useCallback(async (task: TaskEntity): Promise<DecryptedTaskPayload | null> => {
    if (!ClientCryptoService.hasSessionKey()) {
      return null;
    }
    try {
      const decrypted = await ClientCryptoService.decrypt<DecryptedTaskPayload>(task.encryptedPayload);
      return decrypted;
    } catch (err: unknown) {
      console.warn(`Failed to decrypt task ${task.id}:`, err);
      return null;
    }
  }, []);

  const decryptAllTasks = useCallback(async (taskList: TaskEntity[]) => {
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
      setDecryptedPayloads(prev => ({ ...prev, ...results }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error decrypting tasks');
    } finally {
      setIsDecrypting(false);
    }
  }, [decryptTask]);

  // Decrypt on tasks change or initial load
  useEffect(() => {
    decryptAllTasks(tasks);
  }, [tasks, decryptAllTasks]);

  const addTask = useCallback((task: TaskEntity, decrypted?: DecryptedTaskPayload) => {
    setTasks(prev => [task, ...prev]);
    if (decrypted) {
      setDecryptedPayloads(prev => ({ ...prev, [task.id]: decrypted }));
    } else {
      decryptTask(task).then(res => {
        if (res) {
          setDecryptedPayloads(prev => ({ ...prev, [task.id]: res }));
        }
      });
    }
  }, [decryptTask]);

  const updateTaskStatus = useCallback((taskId: string, newStatus: TaskStatus) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          status: newStatus,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));
  }, []);

  const updateTaskPriority = useCallback((taskId: string, newPriority: TaskPriority) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          priority: newPriority,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));
  }, []);

  const toggleSubtask = useCallback((taskId: string, subtaskIndex: number, completed: boolean) => {
    setDecryptedPayloads(prev => {
      const existing = prev[taskId];
      if (!existing || !existing.subtasks || !existing.subtasks[subtaskIndex]) {
        return prev;
      }
      const updatedSubtasks = existing.subtasks.map((st, i) =>
        i === subtaskIndex ? { ...st, completed } : st
      );
      return {
        ...prev,
        [taskId]: {
          ...existing,
          subtasks: updatedSubtasks
        }
      };
    });
  }, []);

  const clearDecryptedPayloads = useCallback(() => {
    setDecryptedPayloads({});
  }, []);

  const draftsCount = tasks.filter(t => t.status === 'DRAFT').length;

  return {
    tasks,
    decryptedPayloads,
    isDecrypting,
    error,
    addTask,
    updateTaskStatus,
    updateTaskPriority,
    toggleSubtask,
    decryptAllTasks,
    clearDecryptedPayloads,
    draftsCount
  };
}
