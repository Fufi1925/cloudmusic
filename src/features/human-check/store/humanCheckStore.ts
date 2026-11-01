import { create } from "zustand";
import {
  setHumanCheckPrompt,
  type HumanCheckFailure,
  type HumanCheckRequest,
} from "@/shared/api/humanCheck";

export type HumanCheckPhase = "loading" | "ready" | "expired" | "error" | "timeout";

interface HumanCheckState {
  request: HumanCheckRequest | null;
  phase: HumanCheckPhase;
  attempt: number;
  /** last thing the verification page said, for the error text */
  note: string | null;
  /** widget restarts done for this request without the user asking */
  autoRestarts: number;
  open: (request: HumanCheckRequest) => Promise<{ token: string | null; failure?: HumanCheckFailure }>;
  setPhase: (phase: HumanCheckPhase, note?: string | null) => void;
  solve: (token: string) => void;
  retry: () => void;
  cancel: () => void;
  /** the widget gave up (no token); may restart itself once, then settles */
  fail: (reason: Exclude<HumanCheckFailure, "cancelled">, note?: string) => void;
}

/** one silent restart, so a single hiccup does not need the user to press anything */
const AUTO_RESTARTS = 1;

let settle: ((value: { token: string | null; failure?: HumanCheckFailure }) => void) | null = null;

function finish(value: { token: string | null; failure?: HumanCheckFailure }) {
  const done = settle;
  settle = null;
  done?.(value);
}

export const useHumanCheckStore = create<HumanCheckState>((set, get) => ({
  request: null,
  phase: "loading",
  attempt: 0,
  note: null,
  autoRestarts: 0,

  open: (request) => {
    finish({ token: null, failure: "cancelled" });
    set((state) => ({
      request,
      phase: "loading",
      attempt: state.attempt + 1,
      note: null,
      autoRestarts: 0,
    }));
    return new Promise((resolve) => {
      settle = resolve;
    });
  },

  setPhase: (phase, note) => set(note === undefined ? { phase } : { phase, note }),

  solve: (token) => {
    set({ request: null });
    finish({ token });
  },

  retry: () =>
    set((state) => ({
      phase: "loading",
      attempt: state.attempt + 1,
      note: null,
      // the user asked for it: the budget starts over
      autoRestarts: 0,
    })),

  fail: (reason, note) => {
    const state = get();
    if (!state.request) return;
    if (state.autoRestarts < AUTO_RESTARTS) {
      set({
        phase: "loading",
        attempt: state.attempt + 1,
        autoRestarts: state.autoRestarts + 1,
        note: note ?? null,
      });
      return;
    }
    set({ request: null, phase: reason, note: note ?? null });
    finish({ token: null, failure: reason });
  },

  cancel: () => {
    set({ request: null, phase: "loading", note: null, autoRestarts: 0 });
    finish({ token: null, failure: "cancelled" });
  },
}));

setHumanCheckPrompt((request) => useHumanCheckStore.getState().open(request));
