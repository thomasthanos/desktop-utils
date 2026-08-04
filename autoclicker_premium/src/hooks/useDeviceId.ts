import { useState, useEffect } from 'react';

const generateDeviceId = (): string => {
  return 'device_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 15);
};

export const useDeviceId = () => {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const api = (window as any).electronAPI;
      if (api?.storage?.getDeviceId) {
        const id = await api.storage.getDeviceId();
        setDeviceId(id);
        return;
      }

      // Fallback: localStorage (dev mode)
      const DEVICE_ID_KEY = 'autoclicker_device_id';
      let id = localStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = generateDeviceId();
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      setDeviceId(id);
    };

    init();
  }, []);

  return deviceId;
};
