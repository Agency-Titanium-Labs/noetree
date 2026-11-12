"use client";

import { useContext } from "react";
import { useQuery, QueryClientContext } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { CommentTarget } from "@/components/CommentComposer";

export function useNoteCommentsQuery(target: CommentTarget | null) {
  const client = useContext(QueryClientContext);

  // If rendered in isolated test environments without QueryClientProvider,
  // return a safe fallback so the rest of the component under test functions normally.
  if (!client) {
    return { data: undefined, isPending: false };
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useQuery({
    ...convexQuery(api.comments.list, { target: target! }),
    enabled: !!target,
  });
}
