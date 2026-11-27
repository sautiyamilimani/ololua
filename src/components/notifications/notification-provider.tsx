"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type NotificationKind = "success" | "error";

type NotificationRequest = {
  kind: NotificationKind;
  message: string;
  persistent?: boolean;
};

type Notification = NotificationRequest & {
  id: number;
};

type NotificationActions = {
  success: (message: string) => void;
  error: (message: string, persistent?: boolean) => void;
};

const NotificationContext = createContext<NotificationActions | null>(null);

export function useNotifications(): NotificationActions {
  const notifications = useContext(NotificationContext);
  if (!notifications) {
    throw new Error("useNotifications must be used within NotificationProvider.");
  }
  return notifications;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const nextId = useRef(0);

  const push = useCallback((notification: NotificationRequest) => {
    const nextNotification = {
      ...notification,
      id: nextId.current++,
    };
    setNotifications((current) => [...current.slice(-2), nextNotification]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setNotifications((current) =>
      current.filter((notification) => notification.id !== id),
    );
  }, []);

  const actions = useMemo<NotificationActions>(
    () => ({
      success: (message) => push({ kind: "success", message }),
      error: (message, persistent = false) =>
        push({ kind: "error", message, persistent }),
    }),
    [push],
  );

  return (
    <NotificationContext.Provider value={actions}>
      {children}
      <div
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 z-[100] mx-auto flex w-full max-w-xl flex-col gap-3 px-4"
        style={{ top: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        {notifications.map((notification) => (
          <NotificationToast
            key={notification.id}
            notification={notification}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    if (notification.persistent) return;

    const timer = window.setTimeout(() => onDismiss(notification.id), 5000);
    return () => window.clearTimeout(timer);
  }, [notification.id, notification.persistent, onDismiss]);

  const isSuccess = notification.kind === "success";

  return (
    <div
      aria-atomic="true"
      aria-live={isSuccess ? "polite" : "assertive"}
      className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_18px_48px_-20px_rgba(7,31,43,.5)] ${
        isSuccess
          ? "border-teal-200 bg-white text-teal-950"
          : "border-red-200 bg-white text-red-950"
      }`}
      role={isSuccess ? "status" : "alert"}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-sm font-bold ${
          isSuccess ? "bg-teal-100 text-teal-800" : "bg-red-100 text-red-800"
        }`}
      >
        {isSuccess ? "✓" : "!"}
      </span>
      <p className="min-w-0 flex-1 text-sm font-medium leading-5">
        {notification.message}
      </p>
      <button
        aria-label={`Dismiss ${notification.kind} notification`}
        className="grid size-8 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
        onClick={() => onDismiss(notification.id)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
