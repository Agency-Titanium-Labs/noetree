"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
  useMemo,
} from "react";

interface HeaderStateContextType {
  title: ReactNode;
  search: ReactNode;
  action: ReactNode;
}

interface HeaderSettersContextType {
  setTitle: (node: ReactNode) => void;
  setSearch: (node: ReactNode) => void;
  setAction: (node: ReactNode) => void;
}

const HeaderStateContext = createContext<HeaderStateContextType | null>(null);
const HeaderSettersContext = createContext<HeaderSettersContextType | null>(
  null,
);

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<ReactNode>(null);
  const [search, setSearch] = useState<ReactNode>(null);
  const [action, setAction] = useState<ReactNode>(null);

  const stateValue = useMemo(
    () => ({
      title,
      search,
      action,
    }),
    [title, search, action],
  );

  const settersValue = useMemo(
    () => ({
      setTitle,
      setSearch,
      setAction,
    }),
    [],
  );

  return (
    <HeaderStateContext.Provider value={stateValue}>
      <HeaderSettersContext.Provider value={settersValue}>
        {children}
      </HeaderSettersContext.Provider>
    </HeaderStateContext.Provider>
  );
}

export function useHeader() {
  const context = useContext(HeaderStateContext);
  if (!context) {
    throw new Error("useHeader must be used within a HeaderProvider");
  }
  return context;
}

export function useHeaderConfig({
  title,
  search,
  action,
}: {
  title?: ReactNode;
  search?: ReactNode;
  action?: ReactNode;
}) {
  const context = useContext(HeaderSettersContext);
  if (!context) {
    throw new Error("useHeaderConfig must be used within a HeaderProvider");
  }
  const { setTitle, setSearch, setAction } = context;

  useEffect(() => {
    if (title !== undefined) {
      setTitle(title);
    }
    return () => {
      if (title !== undefined) {
        setTitle(null);
      }
    };
  }, [title, setTitle]);

  useEffect(() => {
    if (search !== undefined) {
      setSearch(search);
    }
    return () => {
      if (search !== undefined) {
        setSearch(null);
      }
    };
  }, [search, setSearch]);

  useEffect(() => {
    if (action !== undefined) {
      setAction(action);
    }
    return () => {
      if (action !== undefined) {
        setAction(null);
      }
    };
  }, [action, setAction]);
}
