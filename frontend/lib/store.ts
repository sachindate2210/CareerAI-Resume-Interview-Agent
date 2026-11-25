import { create } from "zustand";
import type { UserRead } from "@/types/api";
import { clearAuth, getUser, setUser as persistUser } from "@/lib/auth";

interface AuthState {
  user: UserRead | null;
  setUser: (user: UserRead | null) => void;
  logout: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => {
    if (user) persistUser(user);
    set({ user });
  },
  logout: () => {
    clearAuth();
    set({ user: null });
  },
  hydrate: () => {
    set({ user: getUser() });
  },
}));
