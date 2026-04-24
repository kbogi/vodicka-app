import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionState {
  eventId: string | null;
  stageId: string | null;
  setEvent: (id: string | null) => void;
  setStage: (id: string | null) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      eventId: null,
      stageId: null,
      setEvent: (id) => set({ eventId: id, stageId: null }),
      setStage: (id) => set({ stageId: id }),
    }),
    { name: 'vodicka.session' },
  ),
);
