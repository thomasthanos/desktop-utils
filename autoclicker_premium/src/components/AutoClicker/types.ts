// Position types for the auto-clicker

export interface ClickPosition {
  id: string;
  x: number;
  y: number;
  label: string;
  enabled: boolean;
  customRepeatCount?: number; // Only used in Category 4
}

export interface PositionCategory {
  id: string;
  name: string;
  enabled: boolean;
  positions: ClickPosition[];
  hasCustomRepeat: boolean; // Category 4 has custom repeat per position
}

export type LocationMode = 'current' | 'fixed' | 'multi';

// Default categories structure
export const createDefaultCategories = (): PositionCategory[] => [
  { id: 'cat1', name: 'Category 1', enabled: true, positions: [], hasCustomRepeat: false },
  { id: 'cat2', name: 'Category 2', enabled: false, positions: [], hasCustomRepeat: false },
  { id: 'cat3', name: 'Category 3', enabled: false, positions: [], hasCustomRepeat: false },
  { id: 'cat4', name: 'Category 4', enabled: false, positions: [], hasCustomRepeat: true },
];
