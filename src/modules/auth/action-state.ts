// Shared form-action state for `useActionState`.
// This must NOT live in a "use server" file: those files may only export
// async functions, and `initialActionState` is a plain object consumed on
// the client to seed form state.
export interface ActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Non-sensitive payload for the UI (e.g. a dev-only reset link). */
  data?: Record<string, string>;
}

export const initialActionState: ActionState = { status: "idle" };
