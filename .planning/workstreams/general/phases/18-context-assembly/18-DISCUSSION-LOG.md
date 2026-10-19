# Phase 18: Context Assembly - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-19
**Phase:** 18-context-assembly
**Areas discussed:** Taille et troncature, Notes partagées et publiques, Copies achetées modifiées, Portée parents et enfants

---

## Taille et troncature

| Option                                     | Description                                                                                   | Selected |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | -------- |
| 24 000 caractères, note courante intégrale | ~6 000 jetons; note courante entière sinon refus sans débit; parents puis enfants en extraits | ✓        |
| 12 000 caractères                          | ~3 000 jetons, moins cher, plus de refus                                                      |          |
| 48 000 caractères                          | ~12 000 jetons, coût LLM pouvant dépasser le revenu par crédit                                |          |

**User's choice:** 24 000 caractères, note courante intégrale (recommended)

## Notes partagées et publiques

| Option                                       | Description                                                | Selected |
| -------------------------------------------- | ---------------------------------------------------------- | -------- |
| Seulement les notes dont il est propriétaire | Le contenu d'autrui ne part jamais au LLM                  | ✓        |
| Notes où il a le droit de modifier           | Éditeur invité, ses crédits, accord du propriétaire requis |          |
| Toute note qu'il peut lire                   | Plus permissif, risque RGPD et injection                   |          |

**User's choice:** Seulement les notes dont il est propriétaire (recommended)

## Copies achetées modifiées

| Option                                           | Description                                            | Selected |
| ------------------------------------------------ | ------------------------------------------------------ | -------- |
| Toujours exclue, y compris ses sous-notes        | Drapeau d'achat sur la racine, toute la branche exclue | ✓        |
| Exclue tant qu'elle n'a pas été modifiée         | Détection non fiable                                   |          |
| Seulement les sous-notes ajoutées par l'acheteur | Suivi d'auteur par sous-note                           |          |

**User's choice:** Toujours exclue, y compris ses sous-notes (recommended)

## Portée parents et enfants

| Option                              | Description                                          | Selected |
| ----------------------------------- | ---------------------------------------------------- | -------- |
| Tous les ancêtres + enfants directs | Plafond 20 enfants, pas de petits-enfants            | ✓        |
| Parent direct + enfants directs     | Plus léger                                           |          |
| Ancêtres + sous-arbre profondeur 2  | Coût élevé, recoupe la fonction Premium arborescence |          |

**User's choice:** Tous les ancêtres + enfants directs (recommended)

## Claude's Discretion

Format de sérialisation et délimiteurs, estimation caractères/jetons, emplacement des helpers, longueur des extraits, noms d'erreurs au-delà de CONTEXT_TOO_LARGE, aplatissement du JSON TipTap.

## Deferred Ideas

- IA sur notes partagées/publiques par lecteurs ou éditeurs: phase future
- Plan de toute l'arborescence et `readNote`: phase 20
- Sélection manuelle des notes: non prévu
