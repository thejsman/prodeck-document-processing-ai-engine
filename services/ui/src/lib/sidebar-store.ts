import { create } from 'zustand';

interface SidebarState {
  collapsed: boolean;
  collapse: () => void;
  expand: () => void;
  toggle: () => void;
}

export const useSidebar = create<SidebarState>((set) => ({
  collapsed: typeof window !== 'undefined'
    ? localStorage.getItem('sidebar-collapsed') === 'true'
    : false,
  collapse: () => {
    localStorage.setItem('sidebar-collapsed', 'true');
    set({ collapsed: true });
  },
  expand: () => {
    localStorage.setItem('sidebar-collapsed', 'false');
    set({ collapsed: false });
  },
  toggle: () => set((s) => {
    const next = !s.collapsed;
    localStorage.setItem('sidebar-collapsed', String(next));
    return { collapsed: next };
  }),
}));
