"use client";

import { useEffect, useState } from "react";

export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState<boolean>(() => {
    if (typeof navigator !== "undefined") {
      return /Mac|iPod|iPhone|iPad/i.test(
        navigator.userAgent || navigator.platform || "",
      );
    }
    return false;
  });

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsMac(
        /Mac|iPod|iPhone|iPad/i.test(
          navigator.userAgent || navigator.platform || "",
        ),
      );
    }
  }, []);

  return isMac;
}
