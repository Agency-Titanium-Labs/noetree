# Phase 20: Premium Context and Tree Agent - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-20
**Phase:** 20-premium-context-tree-agent
**Areas discussed:** Contexte personnel, Lancement et coût, Placement des notes, Aperçu et annulation

---

## Contexte personnel

| Option                                          | Description                                                                                | Selected |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| Un texte libre dans Paramètres, appliqué à tout | 1 500 caractères, enregistrer/modifier/supprimer, ajouté automatiquement avec interrupteur | ✓        |
| Plusieurs profils nommés                        | Plus souple, plus de travail d'interface                                                   |          |
| Modifiable seulement dans le chat               | Moins découvrable                                                                          |          |

**User's choice:** Un texte libre dans Paramètres, appliqué à tout (recommended)

## Lancement et coût

| Option                                             | Description                                                   | Selected |
| -------------------------------------------------- | ------------------------------------------------------------- | -------- |
| Mode « Proposer un arbre » dans le chat, 5 crédits | Sélecteur dans le panneau de chat, coût affiché avant l'envoi | ✓        |
| Action séparée dans le menu IA, 3 crédits          | Moins cher, risque de coût LLM supérieur                      |          |
| Mode dans le chat, 8 crédits                       | Plus prudent, décourageant                                    |          |

**User's choice:** Mode « Proposer un arbre » dans le chat, 5 crédits (recommended)

## Placement des notes

| Option                                        | Description                                                           | Selected |
| --------------------------------------------- | --------------------------------------------------------------------- | -------- |
| Sous la note ouverte uniquement               | Enfants de la note ouverte, aucun risque de toucher une autre branche | ✓        |
| N'importe où dans mon arborescence            | Plus puissant, plus risqué                                            |          |
| Sous la note ouverte ou un de ses descendants | Compromis                                                             |          |

**User's choice:** Sous la note ouverte uniquement (recommended)

## Aperçu et annulation

| Option                                            | Description                                     | Selected |
| ------------------------------------------------- | ----------------------------------------------- | -------- |
| Cases à cocher dans le chat, annulation 24 h      | 25 nœuds, 3 niveaux, bouton Annuler le lot 24 h | ✓        |
| Annulation seulement tant que la page est ouverte | Toast, perdu en quittant                        |          |
| Annulation permanente                             | Suivi des modifications de chaque note          |          |

**User's choice:** Cases à cocher dans le chat, annulation 24 h (recommended)

## Claude's Discretion

Génération en sortie structurée streamée ou non, format de l'outline et longueur des extraits, budgets exacts, noms des champs de lot, composant d'arbre à cases, navigation clavier, textes.

## Deferred Ideas

- Profils de contexte nommés: non prévu
- Placement n'importe où ou réorganisation: phase ultérieure
- Édition des nœuds dans l'aperçu: futur
- Annulation permanente: non prévu
