import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useGetNotionSchema } from "@workspace/api-client-react";

interface AccountContextValue {
  accounts: string[];
  selectedAccount: string | null;
  setSelectedAccount: (account: string | null) => void;
  accountColors: Record<string, string>;
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  selectedAccount: null,
  setSelectedAccount: () => {},
  accountColors: {},
});

const ACCOUNT_COLORS = [
  "var(--app-primary)",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f43f5e",
  "#84cc16",
];

const ACCOUNT_PROPERTY_NAMES = [
  "Trading Account",
  "Account",
  "trading account",
  "account",
];

export function AccountProvider({ children }: { children: ReactNode }) {
  const [selectedAccount, setSelectedAccountState] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem("selectedAccount") || null;
      } catch {
        return null;
      }
    }
  );

  const { data: schemaData } = useGetNotionSchema();

  const accounts = useMemo<string[]>(() => {
    if (!schemaData?.schema) return [];
    const schema = schemaData.schema as Record<string, any>;
    for (const propName of ACCOUNT_PROPERTY_NAMES) {
      if (schema[propName]?.type === "select") {
        const opts = schema[propName].select?.options ?? [];
        return opts.map((o: any) => o.name).filter(Boolean);
      }
    }
    return [];
  }, [schemaData]);

  const accountColors = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    accounts.forEach((a, i) => {
      map[a] = ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
    });
    return map;
  }, [accounts]);

  const setSelectedAccount = useCallback((account: string | null) => {
    setSelectedAccountState(account);
    try {
      if (account) localStorage.setItem("selectedAccount", account);
      else localStorage.removeItem("selectedAccount");
    } catch (err) {
      console.warn("[AccountContext] localStorage unavailable — account selection won't persist:", err);
    }
  }, []);

  useEffect(() => {
    if (selectedAccount && accounts.length > 0 && !accounts.includes(selectedAccount)) {
      setSelectedAccount(null);
    }
  }, [accounts, selectedAccount, setSelectedAccount]);

  return (
    <AccountContext.Provider value={{ accounts, selectedAccount, setSelectedAccount, accountColors }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}

export function getAccountProperty(schema: Record<string, any>): string | null {
  for (const propName of ACCOUNT_PROPERTY_NAMES) {
    if (schema[propName]?.type === "select") return propName;
  }
  return null;
}
