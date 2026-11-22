"use client";
// Accessible light/dark toggle (UI-THEME-FOUNDATION-001): a real button, 44 px, visible focus,
// visible label « Thème sombre » with aria-pressed reflecting the state. Before hydration the
// theme is unknown: an inert placeholder of the same size is rendered (no wrong state announced).
import styles from "./theme-toggle.module.css";
import { useUiTheme } from "./theme-provider";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useUiTheme();
  const cls = className ? `${styles.toggle} ${className}` : styles.toggle;
  if (theme === null)
    return (
      <span className={cls} aria-hidden="true" data-theme-toggle="pending">
        <span className={styles.track} />
        <span className={styles.label}>Thème sombre</span>
      </span>
    );
  const dark = theme === "dark";
  return (
    <button type="button" className={cls} aria-pressed={dark} onClick={toggle} data-theme-toggle="ready">
      <span className={styles.track} data-on={dark ? "true" : "false"} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      <span className={styles.label}>Thème sombre</span>
    </button>
  );
}
