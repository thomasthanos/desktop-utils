import { useState, useEffect, useCallback, useRef } from 'react';
import type { MouseButton } from '@/components/AutoClicker/MouseButtonSelect';
import type { ClickType } from '@/components/AutoClicker/ClickTypeSelect';
import type { RepeatMode } from '@/components/AutoClicker/RepeatSettings';
import type { LocationMode } from '@/components/AutoClicker/LocationSettings';

export interface AppSettings {
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  randomEnabled: boolean;
  randomMin: number;
  randomMax: number;
  mouseButton: MouseButton;
  clickType: ClickType;
  repeatMode: RepeatMode;
  repeatCount: number;
  locationMode: LocationMode;
  clicksPerPosition: number;
  startStopKey: string;
  emergencyStopKey: string;
}

const SETTINGS_KEY = 'autoclicker_settings';

const defaultSettings: AppSettings = {
  hours: 0,
  minutes: 0,
  seconds: 0,
  milliseconds: 200,
  randomEnabled: false,
  randomMin: 0.1,
  randomMax: 0.2,
  mouseButton: 'left',
  clickType: 'single',
  repeatMode: 'until_stopped',
  repeatCount: 100,
  locationMode: 'current',
  clicksPerPosition: 1,
  startStopKey: 'F6',
  emergencyStopKey: 'F7',
};

export const useAppSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings(prev => ({ ...prev, ...parsed }));
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Update settings with debounced save to localStorage
  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => {
      const newSettings = { ...prev, ...updates };

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
        } catch (err) {
          console.error('Error saving settings:', err);
        }
      }, 500);

      return newSettings;
    });
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    settings,
    loading,
    syncing: false,
    updateSettings,
    refreshSettings: () => {},
  };
};
