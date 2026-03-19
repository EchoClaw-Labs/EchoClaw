import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "theme";

function getIsDark(): boolean {
  const html = document.documentElement;
  return html.classList.contains("dark");
}

function applyTheme(dark: boolean): void {
  const html = document.documentElement;
  if (dark) {
    html.classList.add("dark");
  } else {
    html.classList.remove("dark");
  }
  localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
}

/** Initialise the html class from localStorage / system preference (call once). */
function initTheme(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") {
    const dark = stored === "dark";
    applyTheme(dark);
    return dark;
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark);
  return prefersDark;
}

export interface UseThemeReturn {
  isDark: boolean;
  toggle: (event?: React.MouseEvent) => void;
}

/**
 * Light / dark theme hook with localStorage persistence and View Transition API.
 *
 * On toggle the hook will use `document.startViewTransition` when available
 * to create a circular clip-path reveal centred on the click coordinates.
 * Falls back to an instant class swap on older browsers.
 */
export function useTheme(): UseThemeReturn {
  const [isDark, setIsDark] = useState(getIsDark);

  // First mount: sync html class with stored preference
  useEffect(() => {
    const initialDark = initTheme();
    setIsDark(initialDark);
  }, []);

  // MutationObserver: keep React state in sync if anything else touches the class
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(getIsDark());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback((event?: React.MouseEvent) => {
    const next = !getIsDark();

    // If View Transition API is available, use a circular clip-path reveal
    if (document.startViewTransition && event) {
      const x = event.clientX;
      const y = event.clientY;
      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      const transition = document.startViewTransition(() => {
        applyTheme(next);
      });

      transition.ready.then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 500,
            easing: "ease-in-out",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      }).catch(() => {
        // Transition cancelled or unsupported — already applied above
      });
    } else {
      applyTheme(next);
    }
  }, []);

  return { isDark, toggle };
}
