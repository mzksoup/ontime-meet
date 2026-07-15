import { useCallback, useEffect, useState } from "react";
import { getIcsUrl, setIcsUrl } from "../storage";

export function useIcsUrl() {
  const [icsUrl, setIcsUrlState] = useState<string | null>(null);

  useEffect(() => {
    getIcsUrl().then(setIcsUrlState);
  }, []);

  const save = useCallback((value: string) => {
    const trimmed = value.trim() || null;
    setIcsUrl(trimmed).then(() => {
      setIcsUrlState(trimmed);
      chrome.runtime.sendMessage({ type: "RefreshRequest" });
    });
  }, []);

  return { icsUrl, save };
}
