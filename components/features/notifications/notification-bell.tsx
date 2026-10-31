"use client";
// Header bell for every connected role. The count is the server's or nothing: when the contract
// is not available the button stays visible but disabled and explicitly says so.
import { Icon } from "../../app/icons";
import { bellLabel, type ContractState } from "../../../lib/features/notifications/leaf";
import styles from "./notifications.module.css";

export type NotificationBellProps = {
  state: ContractState;
  unreadCount: number | null;
  onOpen: () => void;
  label?: string;
};
export function NotificationBell({ state, unreadCount, onOpen, label }: NotificationBellProps) {
  const available = state === "available";
  const text = label ?? bellLabel(unreadCount, state);
  const count = available && unreadCount !== null && unreadCount > 0 ? unreadCount : null;
  return (
    <button type="button" className={styles.bell} aria-label={text} title={text} disabled={!available} data-blocker={available ? undefined : `capability:notifications:${state}`} onClick={onOpen}>
      <Icon name="bell" size={20} />
      {count !== null && <span className={styles.bellCount} aria-hidden="true">{count > 99 ? "99+" : count}</span>}
    </button>
  );
}
