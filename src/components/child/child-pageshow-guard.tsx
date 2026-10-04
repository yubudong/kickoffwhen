"use client";

import { useEffect } from "react";

export function shouldRevalidateChildPage(event: Pick<PageTransitionEvent, "persisted">) {
  return event.persisted;
}

export function createChildPageShowHandler(revalidate: () => void) {
  return (event: Pick<PageTransitionEvent, "persisted">) => {
    if (shouldRevalidateChildPage(event)) revalidate();
  };
}

export function ChildPageShowGuard() {
  useEffect(() => {
    const guard = createChildPageShowHandler(() => window.location.reload());
    window.addEventListener("pageshow", guard);
    return () => window.removeEventListener("pageshow", guard);
  }, []);
  return null;
}
