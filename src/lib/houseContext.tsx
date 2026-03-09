import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export interface HouseInfo {
  id: string;
  name: string;
  code: string;
  role: 'admin' | 'member';
  isPrimaryAdmin: boolean;
  status: 'active' | 'blocked' | 'pending';
  joinedAt: string | null;
}

interface HouseContextType {
  houses: HouseInfo[];
  activeHouse: HouseInfo | null;
  setActiveHouse: (house: HouseInfo) => void;
  setHouses: (houses: HouseInfo[]) => void;
}

const ACTIVE_HOUSE_KEY = 'fortinest_active_house_id';

const HouseContext = createContext<HouseContextType | null>(null);

export const useHouse = () => {
  const ctx = useContext(HouseContext);
  if (!ctx) throw new Error('useHouse must be used within HouseProvider');
  return ctx;
};

export const HouseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [houses, setHousesState] = useState<HouseInfo[]>([]);
  const [activeHouse, setActiveHouseState] = useState<HouseInfo | null>(null);

  const setHouses = useCallback((newHouses: HouseInfo[]) => {
    setHousesState(newHouses);
    // Restore saved active house or pick first active
    const savedId = localStorage.getItem(ACTIVE_HOUSE_KEY);
    const saved = newHouses.find(h => h.id === savedId && h.status === 'active');
    const firstActive = newHouses.find(h => h.status === 'active');
    setActiveHouseState(saved || firstActive || newHouses[0] || null);
  }, []);

  const setActiveHouse = useCallback((house: HouseInfo) => {
    setActiveHouseState(house);
    localStorage.setItem(ACTIVE_HOUSE_KEY, house.id);
  }, []);

  return (
    <HouseContext.Provider value={{ houses, activeHouse, setActiveHouse, setHouses }}>
      {children}
    </HouseContext.Provider>
  );
};
