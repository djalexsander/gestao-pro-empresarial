import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CartItem = {
  kind: "plano" | "modulo";
  id: string;
  nome: string;
  valor: number;
};

type CartCtx = {
  items: CartItem[];
  count: number;
  total: number;
  has: (kind: CartItem["kind"], id: string) => boolean;
  add: (item: CartItem) => void;
  remove: (kind: CartItem["kind"], id: string) => void;
  toggle: (item: CartItem) => void;
  clear: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
};

const Ctx = createContext<CartCtx | null>(null);
const STORAGE_KEY = "gestao-pro:cart-v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
      return [];
    }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }, [items]);

  const has = useCallback(
    (kind: CartItem["kind"], id: string) =>
      items.some((i) => i.kind === kind && i.id === id),
    [items],
  );

  const add = useCallback((item: CartItem) => {
    setItems((prev) =>
      prev.some((i) => i.kind === item.kind && i.id === item.id)
        ? prev
        : [...prev, item],
    );
  }, []);

  const remove = useCallback((kind: CartItem["kind"], id: string) => {
    setItems((prev) => prev.filter((i) => !(i.kind === kind && i.id === id)));
  }, []);

  const toggle = useCallback((item: CartItem) => {
    setItems((prev) => {
      const exists = prev.some((i) => i.kind === item.kind && i.id === item.id);
      return exists
        ? prev.filter((i) => !(i.kind === item.kind && i.id === item.id))
        : [...prev, item];
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartCtx>(
    () => ({
      items,
      count: items.length,
      total: items.reduce((s, i) => s + Number(i.valor || 0), 0),
      has,
      add,
      remove,
      toggle,
      clear,
      open,
      setOpen,
    }),
    [items, has, add, remove, toggle, clear, open],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart deve ser usado dentro de <CartProvider>");
  return ctx;
}
