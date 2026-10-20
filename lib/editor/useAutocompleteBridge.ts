"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { aiErrorCode } from "@/convex/helpers/aiErrors";
import {
  GHOST_TEXT_DEFAULTS,
  type GhostRequestResult,
  type GhostTextOptions,
} from "./ghostText";
import {
  resetAutocompleteStatus,
  setAutocompleteAnnouncement,
  setAutocompletePaused,
} from "./autocompleteStatus";

type CompleteResponse =
  | { status: "suggestion"; suggestionId: string; text: string }
  | { status: "none" }
  | { status: "paused" };

/** HTTP statuses that mean "stop asking for now", answered quietly. */
const PAUSING_STATUSES = new Set([401, 402, 403, 429, 503]);

/**
 * Suggestions are accepted with Tab, so a device with no fine pointer at all
 * (a phone or tablet without a trackpad, hence no hardware keyboard to count
 * on) never asks: it would pay for model calls it cannot accept (21-REVIEW
 * L3). Where matchMedia is unavailable the answer is yes.
 */
export function canAcceptWithTab(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(any-pointer: fine)").matches;
}

/**
 * Connects the ghost-text extension to the app: the account preference, the
 * /api/ai/complete route and the accept/dismiss mutations. Everything the
 * extension reads at call time goes through refs, so the options object is
 * created once per mount while the editor (re-created on every note switch)
 * keeps seeing the current note and the current toggle value.
 *
 * `enabled` is the EFFECTIVE value (Premium and switched on and AI available)
 * as computed by the server; a Free user is never enabled, so no request is
 * ever made for them.
 */
export function useAutocompleteBridge(noteId: string | undefined): {
  options: GhostTextOptions;
  enabled: boolean;
} {
  const tCredits = useTranslations("AiCredits");
  const t = useTranslations("Autocomplete");
  const { data: pref } = useQuery(
    convexQuery(api.aiSuggestions.getMyAutocomplete, {}),
  );
  const acceptMutation = useConvexMutation(api.aiSuggestions.accept);
  const dismissMutation = useConvexMutation(api.aiSuggestions.dismiss);

  const enabled = Boolean(pref?.enabled) && Boolean(noteId);
  const live = useRef({
    enabled,
    noteId,
    accept: acceptMutation,
    dismiss: dismissMutation,
    tCredits,
    t,
  });
  live.current = {
    enabled,
    noteId,
    accept: acceptMutation,
    dismiss: dismissMutation,
    tCredits,
    t,
  };

  useEffect(() => {
    if (!enabled) resetAutocompleteStatus();
  }, [enabled]);

  const options = useMemo<GhostTextOptions>(
    () => ({
      ...GHOST_TEXT_DEFAULTS,
      isEnabled: () => live.current.enabled && canAcceptWithTab(),

      async request({ textBefore, signal }): Promise<GhostRequestResult> {
        const noteId = live.current.noteId;
        if (!noteId) return { status: "none" };
        const res = await fetch("/api/ai/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ noteId, textBefore }),
          signal,
        });
        if (!res.ok) {
          return PAUSING_STATUSES.has(res.status)
            ? { status: "paused" }
            : { status: "none" };
        }
        const data = (await res.json()) as CompleteResponse;
        if (data.status === "suggestion") {
          return {
            status: "suggestion",
            id: data.suggestionId,
            text: data.text,
          };
        }
        return data.status === "paused"
          ? { status: "paused" }
          : { status: "none" };
      },

      async accept(id) {
        try {
          const r = await live.current.accept({
            suggestionId: id as Id<"aiSuggestions">,
          });
          return { ok: true, text: r.text };
        } catch (err) {
          return { ok: false, code: aiErrorCode(err) ?? undefined };
        }
      },

      dismiss(id) {
        // Fire and forget: the row also expires on its own.
        void Promise.resolve(
          live.current.dismiss({ suggestionId: id as Id<"aiSuggestions"> }),
        ).catch(() => {});
      },

      onPausedChange: setAutocompletePaused,

      onAcceptError(code) {
        // The only loud failure (D-05): nothing was inserted, nothing charged.
        const key = code ? `errors.${code}` : "errors.GENERIC";
        toast.error(live.current.tCredits(key));
      },

      announce(text) {
        setAutocompleteAnnouncement(
          text ? live.current.t("suggestionAnnounce", { text }) : "",
        );
      },
    }),
    [],
  );

  return { options, enabled };
}
