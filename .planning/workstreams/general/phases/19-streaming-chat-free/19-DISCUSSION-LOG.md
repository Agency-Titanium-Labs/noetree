# Phase 19: Streaming Chat (Free) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-20
**Phase:** 19-streaming-chat-free
**Areas discussed:** Où vit le chat, Que faire de la réponse, Coût en crédits par message, États et erreurs visibles

---

## Où vit le chat

| Option                       | Description                                                                      | Selected |
| ---------------------------- | -------------------------------------------------------------------------------- | -------- |
| Panneau ancré sous la note   | S'ouvre depuis le menu IA, redimensionnable, la note reste visible et modifiable | ✓        |
| Tiroir latéral droit (sheet) | Par-dessus l'éditeur, cache une partie de la note                                |          |
| Fenêtre modale               | Bloque l'éditeur pendant la conversation                                         |          |

**User's choice:** Panneau ancré sous la note (recommended)

## Que faire de la réponse

| Option                                 | Description                                                              | Selected |
| -------------------------------------- | ------------------------------------------------------------------------ | -------- |
| Copier + insérer dans la note          | Insérer à la position du curseur après validation; sous-notes = phase 20 | ✓        |
| Copier seulement                       | Strictement CHAT-01                                                      |          |
| Copier + insérer + créer une sous-note | Empiète sur la phase 20                                                  |          |

**User's choice:** Copier + insérer dans la note (recommended)

## Coût en crédits par message

| Option                                                          | Description                                     | Selected |
| --------------------------------------------------------------- | ----------------------------------------------- | -------- |
| 1 crédit par message, historique limité aux 6 derniers échanges | Même coût avec ou sans contexte, coût LLM borné | ✓        |
| 1 crédit sans contexte, 3 avec le contexte                      | Plus juste côté coûts, plus compliqué           |          |
| 1 crédit par conversation                                       | Coût LLM non borné, risque d'abus               |          |

**User's choice:** 1 crédit par message, historique 6 derniers échanges (recommended)

## États et erreurs visibles

| Option                             | Description                                                    | Selected |
| ---------------------------------- | -------------------------------------------------------------- | -------- |
| Messages dans le fil de discussion | Bulle système distincte par état, attachée au message concerné | ✓        |
| Notifications toast                | Temporaires, perdent le lien avec le message                   |          |
| Bannière fixe en haut du panneau   | Un seul état à la fois                                         |          |

**User's choice:** Messages dans le fil de discussion (recommended)

## Claude's Discretion

Design visuel du panneau, rendu Markdown assaini, texte du prompt système, protocole de flux AI SDK v7, mapping de l'insertion vers les commandes TipTap, raccourcis, défilement automatique.

## Deferred Ideas

- Historique de chat persisté: futur
- Création de sous-notes depuis une réponse: phase 20
- Choix du modèle ou de la langue par conversation, voix, pièces jointes: non prévu
