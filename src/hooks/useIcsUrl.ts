import { useCallback, useEffect, useState } from "react";
import { getIcsUrl, setIcsUrl } from "../storage";

export function useIcsUrl() {
  const [icsUrl, setIcsUrlState] = useState<string | null>(null);

  useEffect(() => {
    getIcsUrl().then(setIcsUrlState);
  }, []);

  const save = useCallback((value: string) => {
    const trimmed = value.trim() || null;
    // caller is responsible for triggering a refetch (useEvents.refresh
    // already sends its own RefreshRequest) - avoid double-fetching here.
    return setIcsUrl(trimmed).then(() => setIcsUrlState(trimmed));
  }, []);

  return { icsUrl, save };
}
