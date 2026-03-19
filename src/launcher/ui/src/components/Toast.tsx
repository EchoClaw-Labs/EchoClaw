import { type FC, useEffect, useState, useCallback, createContext, useContext, type ReactNode } from "react";
import { cn } from "../utils";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

let toastId = 0;

export const ToastProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++toastId;
    setItems(prev => [...prev, { id, message, type }]);
    setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {items.map(item => (
          <ToastNotification key={item.id} item={item} onDismiss={() => setItems(prev => prev.filter(t => t.id !== item.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

const TOAST_STYLES: Record<ToastType, string> = {
  success: "border-status-ok/30 bg-status-ok/10 text-status-ok",
  error: "border-status-error/30 bg-status-error/10 text-status-error",
  info: "border-white/[0.1] bg-zinc-900 text-zinc-200",
};

const ToastNotification: FC<{ item: ToastItem; onDismiss: () => void }> = ({ item, onDismiss }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => setVisible(false), 3600);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      onClick={onDismiss}
      className={cn(
        "pointer-events-auto cursor-pointer rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-sm",
        "transition-all duration-300 ease-out",
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        TOAST_STYLES[item.type],
      )}
    >
      {item.message}
    </div>
  );
};
