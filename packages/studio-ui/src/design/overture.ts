/**
 * Whether to play the first-run overture.
 *
 * The overture is a curtain: it covers the Studio until someone presses a key or clicks. That is
 * the right shape for a human opening FrameDiff for the first time, and the wrong shape for
 * everything else that drives this UI — the e2e suite, and more importantly the agent surface
 * this product deliberately exposes on `window.__framediffAgent`. A greeting that a script has to
 * know how to dismiss is not a greeting, it is a bug with good intentions.
 *
 * So the rule is: show it once, to a human, and never let it stand between automation and the
 * application.
 */

export type OvertureConditions = {
  /** This project's overture has been dismissed before. */
  seen: boolean;
  /** WebDriver or another automation harness is driving. */
  automated: boolean;
  /** Explicit opt-in, used to test the overture itself under automation. */
  forced: boolean;
};

export function shouldShowOverture({ seen, automated, forced }: OvertureConditions): boolean {
  // The override exists so the overture stays covered by its own e2e test. It beats every other
  // rule, including "already seen", so a test can replay it deterministically.
  if (forced) return true;
  if (automated) return false;
  return !seen;
}

/** Read the conditions from the browser. Returns "never show" when there is no window at all. */
export function overtureConditions(storageKey: string): OvertureConditions {
  if (typeof window === "undefined") return { seen: true, automated: true, forced: false };

  let seen = true;
  try {
    seen = !!window.localStorage.getItem(storageKey);
  } catch {
    // Private browsing with storage denied: treat it as a first visit rather than never greeting
    // anyone. The cost of showing it twice is far lower than never showing it.
    seen = false;
  }

  return {
    seen,
    automated: !!navigator.webdriver,
    forced: new URLSearchParams(window.location.search).get("overture") === "1",
  };
}
