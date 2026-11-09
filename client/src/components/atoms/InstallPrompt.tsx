import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './Button';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface InstallPromptProps {
  className?: string;
  style?: React.CSSProperties;
  onInstalled?: () => void;
}

export const InstallPrompt: React.FC<InstallPromptProps> = ({
  className = '',
  style,
  onInstalled,
}) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      Boolean(window.matchMedia?.('(display-mode: standalone)').matches) ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  });
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsDismissed(false);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      if (onInstalled) {
        onInstalled();
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [onInstalled]);

  const handleInstallClick = useCallback(async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult?.outcome === 'accepted') {
        setIsInstalled(true);
        if (onInstalled) {
          onInstalled();
        }
      } else {
        setIsDismissed(true);
      }
    } catch {
      setIsDismissed(true);
    } finally {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt, onInstalled]);

  if (isInstalled || isDismissed || !deferredPrompt) {
    return null;
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleInstallClick}
      aria-label="Install OSCAR App"
      className={`oscar-install-button ${className}`.trim()}
      style={{
        backgroundColor: '#0f172a',
        color: '#38bdf8',
        border: '1px solid #1e293b',
        fontWeight: 600,
        fontSize: '0.75rem',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        ...style,
      }}
    >
      📲 Install App
    </Button>
  );
};
