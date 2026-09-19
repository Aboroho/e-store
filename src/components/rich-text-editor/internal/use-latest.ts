"use client";

import * as React from "react";

/**
 * A ref that always holds the latest value, for callbacks handed to the editor once
 * (extension options, ProseMirror props) that must still see current props and state.
 * The write happens in a layout effect, so it is committed before any event can fire.
 */
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  React.useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
