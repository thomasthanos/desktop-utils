import { useState, useEffect, useCallback } from 'react';
import type { ClickPosition, PositionCategory } from '@/components/AutoClicker/types';

export interface SavedProfile {
  id: string;
  name: string;
  positions: ClickPosition[];
  categories?: PositionCategory[];
  created_at: string;
  updated_at: string;
}

const getStorageAPI = () => {
  const api = (window as any).electronAPI;
  return api?.storage ?? null;
};

export const useSavedLocations = () => {
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const storage = getStorageAPI();
      if (!storage) throw new Error('Storage not available');
      const data: SavedProfile[] = await storage.getProfiles();
      setProfiles(data || []);
    } catch (err) {
      console.error('Error fetching profiles:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  const saveProfile = useCallback(async (
    name: string,
    positions: ClickPosition[],
    categories?: PositionCategory[]
  ) => {
    try {
      const storage = getStorageAPI();
      if (!storage) throw new Error('Storage not available');
      const result: SavedProfile = await storage.saveProfile({ name, positions, categories });
      await fetchProfiles();
      return result;
    } catch (err) {
      console.error('Error saving profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to save profile');
      return null;
    }
  }, [fetchProfiles]);

  const updateProfile = useCallback(async (
    id: string,
    name: string,
    positions: ClickPosition[],
    categories?: PositionCategory[]
  ) => {
    try {
      const storage = getStorageAPI();
      if (!storage) throw new Error('Storage not available');
      await storage.deleteProfile(id);
      await storage.saveProfile({ name, positions, categories });
      await fetchProfiles();
      return true;
    } catch (err) {
      console.error('Error updating profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to update profile');
      return false;
    }
  }, [fetchProfiles]);

  const deleteProfile = useCallback(async (id: string) => {
    try {
      const storage = getStorageAPI();
      if (!storage) throw new Error('Storage not available');
      await storage.deleteProfile(id);
      await fetchProfiles();
      return true;
    } catch (err) {
      console.error('Error deleting profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete profile');
      return false;
    }
  }, [fetchProfiles]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  return {
    profiles,
    loading,
    error,
    saveProfile,
    updateProfile,
    deleteProfile,
    refreshProfiles: fetchProfiles,
  };
};
