import { create } from 'zustand';

interface MobileNavState {
  mobileOpen: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
}

export const useMobileNav = create<MobileNavState>((set) => ({
  mobileOpen: false,
  openMobileNav: () => set({ mobileOpen: true }),
  closeMobileNav: () => set({ mobileOpen: false }),
}));
