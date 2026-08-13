import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function getPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * The real OS-level `prefers-reduced-motion: reduce` signal, for
 * components that need to branch LOGIC (skip an animation entirely,
 * not just speed it to 0ms — e.g. `Spinner` swapping a spin animation
 * for a static icon). Most components don't need this hook at all:
 * they read `--motion-duration-*` (tokens.css) in CSS, and both the
 * real media query and Storybook's manual toggle already zero those
 * out. Reach for this hook only when CSS alone can't express the
 * change.
 */
export function useReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(getPrefersReducedMotion);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQueryList = window.matchMedia(QUERY);
    const handleChange = () => setPrefers(mediaQueryList.matches);
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, []);

  return prefers;
}
