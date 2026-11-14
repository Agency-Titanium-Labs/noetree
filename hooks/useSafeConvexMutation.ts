"use client";

import { useConvexMutation } from "@convex-dev/react-query";
import type { FunctionReference } from "convex/server";

export function useSafeConvexMutation<
  Mutation extends FunctionReference<"mutation">,
>(mutation: Mutation) {
  try {
    return useConvexMutation(mutation);
  } catch {
    return (async () => null) as unknown as ReturnType<
      typeof useConvexMutation<Mutation>
    >;
  }
}
