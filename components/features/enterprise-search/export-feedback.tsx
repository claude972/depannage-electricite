// Inline result of the server CSV export, next to the « Exporter » button (tokens only).
import styles from "./enterprise-search.module.css";

export function ExportFeedback({ notice, error }: { notice: string; error: string }) {
  if (!notice && !error) return null;
  return error ? (
    <span role="alert" className={styles.error} data-enterprise-export-error="">{error}</span>
  ) : (
    <span role="status" className={styles.notice} data-enterprise-export-notice="">{notice}</span>
  );
}
