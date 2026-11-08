import { useState, useCallback, useEffect } from 'react';
import { PIIType, RiskLevel } from '../types/contracts';
import { ClientCryptoService } from '../services/ClientCryptoService';

export interface PrivacyShieldState {
  hasActiveKey: boolean;
  totalTokensMasked: number;
  tokensByType: Partial<Record<PIIType, number>>;
  sessionRiskLevel: RiskLevel;
}

export function usePrivacyShield() {
  const [hasActiveKey, setHasActiveKey] = useState<boolean>(() => ClientCryptoService.hasSessionKey());
  const [totalTokensMasked, setTotalTokensMasked] = useState<number>(0);
  const [tokensByType, setTokensByType] = useState<Partial<Record<PIIType, number>>>({
    SECRET_KEY: 0,
    IBAN: 0,
    EMAIL: 0,
    PHONE: 0,
    AMOUNT_MONEY: 0,
    PERSON: 0
  });
  const [sessionRiskLevel, setSessionRiskLevel] = useState<RiskLevel>('NONE');

  // Sync active key state periodically or on change
  const refreshKeyState = useCallback(() => {
    setHasActiveKey(ClientCryptoService.hasSessionKey());
  }, []);

  useEffect(() => {
    refreshKeyState();
  }, [refreshKeyState]);

  const recordMaskedTokens = useCallback((newTokens: { type: PIIType }[]) => {
    if (!newTokens.length) return;

    setTokensByType((prev) => {
      const updated = { ...prev };
      for (const tok of newTokens) {
        updated[tok.type] = (updated[tok.type] || 0) + 1;
      }
      return updated;
    });

    setTotalTokensMasked((prev) => {
      const newTotal = prev + newTokens.length;
      return newTotal;
    });

    // Recalculate session risk
    setTokensByType((currentMap) => {
      const hasSecret = (currentMap.SECRET_KEY || 0) > 0;
      const financialCount = (currentMap.IBAN || 0) + (currentMap.AMOUNT_MONEY || 0);
      const totalCount = Object.values(currentMap).reduce((acc: number, val) => acc + (val || 0), 0);

      if (hasSecret || totalCount >= 8) {
        setSessionRiskLevel('HIGH');
      } else if (financialCount > 0 || totalCount >= 3) {
        setSessionRiskLevel('MEDIUM');
      } else if (totalCount > 0) {
        setSessionRiskLevel('LOW');
      } else {
        setSessionRiskLevel('NONE');
      }
      return currentMap;
    });
  }, []);

  const logoutAndZeroKey = useCallback(() => {
    ClientCryptoService.logout();
    setHasActiveKey(false);
  }, []);

  const initializeKey = useCallback((key?: Uint8Array | string) => {
    ClientCryptoService.initializeSessionKey(key);
    setHasActiveKey(true);
  }, []);

  return {
    hasActiveKey,
    totalTokensMasked,
    tokensByType,
    sessionRiskLevel,
    recordMaskedTokens,
    logoutAndZeroKey,
    initializeKey,
    refreshKeyState
  };
}
