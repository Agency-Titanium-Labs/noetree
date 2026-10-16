# Noetree

## What This Is

Noetree est une application web de prise de notes hiérarchique (style Notion/Obsidian) où les utilisateurs créent et organisent des notes en arborescence. L'app cible les individus qui veulent structurer leur connaissance dans une interface épurée. Construite avec Next.js, Convex (backend temps réel) et Shadcn UI.

## Core Value

Un utilisateur peut créer, organiser et naviguer dans ses notes en structure arborescente — la navigation et la hiérarchie doivent toujours fonctionner.

## Current Milestone: v1.2 Pricing V2 & Fonctionnalités Sociales

**Goal :** Passer à un modèle freemium sans limite de notes, avec de nouvelles fonctionnalités sociales (partage, commentaires, historique) et un système de crédits IA revu.

**Target features :**

- Suppression du plafond de 20 notes gratuites (illimité pour tous les plans)
- Renommage du plan Pro → Premium, repricing (9€/mois → 6,99€/mois ou 59€/an), migration des abonnés existants
- Partage & droits d'accès (liens uniques, lecture seule/modification, notes publiques) — 100% gratuit et illimité
- Commentaires & notifications
- Historique & restauration de versions (Free limité ~24h, Premium historique complet + restauration)
- Système de crédits IA revu (coûts différenciés par action : 1 crédit basique, 3-5 crédits complexe/sémantique ; nouveaux quotas mensuels Free/Premium ; 3 packs d'achat à la carte)

**Explicitement hors scope de cette milestone :**

- Collaboration temps réel (co-édition + chat) — reportée à une milestone future
- Commission marketplace différenciée (20%/10%) — déjà intégrée dans la milestone v1.1 en cours sur la branche `milestone/v1.1-marketplace-de-notes` (worktree séparé, ne pas dupliquer)

**Précédent milestone shipped :** v1.0 Monétisation & Paiements — voir `.planning/MILESTONES.md` pour le détail complet

## Parallel Milestone: v1.1 Marketplace de notes (branche milestone/v1.1-marketplace-de-notes)

**Goal :** Permettre aux utilisateurs de vendre et acheter des notes entre eux via Stripe Connect, avec commission Noetree.

**Target features :**

- Page marketplace publique (browse + recherche)
- Mise en vente d'une note : prix libre, choix note seule ou note+sous-arbre, choix copie éditable ou accès lecture seule pour l'acheteur
- Aperçu partiel (titre + description + extrait) avant achat
- Achat via Stripe Checkout, payout automatique vendeur via Stripe Connect (onboarding KYC géré par Stripe)
- Commission Noetree différenciée : 20% (vendeur Free) / 10% (vendeur Premium) prélevée à la source sur chaque vente
- Vente ouverte à tous (Free + Pro)
- Notes achetées en mode copie comptent dans le quota 20 notes Free existant
- Ventes finales, pas de remboursement (contenu numérique)
- Pas de modération de contenu ce milestone (déféré à plus tard)

**Previous milestone:** v1.0 Monétisation & Paiements — Shipped 2026-07-12, voir `.planning/MILESTONES.md` pour le détail complet

## Requirements

### Validated

<!-- Fonctionnalités livrées et confirmées. -->

- ✓ Authentification utilisateur (Clerk) — v0.x
- ✓ CRUD notes avec Convex (créer, lire, mettre à jour, supprimer) — v0.x
- ✓ Structure arborescente des notes (parent/enfant) — v0.x
- ✓ Drag & drop des nœuds dans l'arbre — v0.x
- ✓ Éditeur de texte riche avec panneaux redimensionnables (Shadcn Resizable) — v0.x
- ✓ Dark mode — v0.x
- ✓ CI/CD GitHub Actions + Vercel (staging/production) — v0.x
- ✓ Stripe webhooks update subscription status in Convex — Phase 2 (PAY-03)
- ✓ Pro user receives monthly AI credits quota (granted at initial checkout, reset on billing cycle) — Phase 2 + Phase 06.1 (CRED-01, PLAN-05)
- ✓ Pro tier user has unlimited notes — Phase 4 (PLAN-03)
- ✓ User can view remaining AI credits balance in the app (toolbar badge, visible for both Free and Pro tiers) — Phase 5 (CRED-02)
- ✓ AI credits are deducted atomically when an AI action is used, with TOCTOU-safe concurrency protection — Phase 5 (CRED-04)
- ✓ User can trigger a top-up purchase when credits are low; blocked with plan-appropriate prompt at 0 credits — Phase 5 (CRED-03)
- ✓ User can purchase AI credits top-up via Stripe Checkout (one-time payment mode) — Phase 5 (PAY-05)
- ✓ User can view and manage subscription in Settings page (plan, renewal date/status, credits balance, top-up history) — Phase 6 (SET-01, SET-02, SET-03, SET-05)
- ✓ User can cancel Pro subscription with confirmation, without immediate access loss; correctly downgrades to Free at period end — Phase 6 (SET-04, PAY-04)
- ✓ User can view pricing page (Free vs Pro plans) — Phase 3 (PLAN-01)
- ✓ User can subscribe to Pro plan via Stripe Checkout, with in-app confirmation after activation — Phase 3 (PAY-01, PAY-02)
- ✓ Seller can complete Stripe Connect (Express) onboarding from Settings; capability status is webhook-driven and enforceable server-side via `isSellerActive` — Phase 7 (CONNECT-01, CONNECT-02, CONNECT-03)

### Active

<!-- Scope actif : deux milestones en parallèle (workstreams general = v1.2, marketplace = v1.1). -->

**Milestone v1.2 (Pricing V2 & social) :** voir `.planning/workstreams/general/REQUIREMENTS.md`.

**Milestone v1.1 (Marketplace) :**

- [ ] Page marketplace publique (browse + recherche de notes en vente)
- [ ] Mise en vente d'une note (prix, portée note/sous-arbre, mode copie/lecture seule)
- [ ] Aperçu partiel avant achat
- [ ] Achat via Stripe Checkout + payout vendeur via Stripe Connect
- [ ] Commission Noetree (15%) prélevée à la source

### Out of Scope

- Free tier limité à 20 notes — **invalidé pour v1.2** : la philosophie produit passe à "notes illimitées pour tous, seule l'IA est un usage mesuré/facturé". La feature `PLAN-02`/`PLAN-04` (Phase 4 v1.0) sera supprimée par cette milestone.
- Plan Business/Teams — complexité équipe hors scope pour l'instant
- Portail Stripe natif — UI custom dans l'app choisie à la place
- Remboursements / prorations manuels — Stripe gère automatiquement
- Collaboration temps réel (co-édition + chat) — reportée à une milestone future (hors scope v1.2)
- Modération de contenu marketplace — déféré (v1.1)
- Remboursement acheteur — ventes finales (v1.1)

## Context

- **Stack :** Next.js 15 App Router, Convex (real-time DB + backend functions), Shadcn UI, Clerk auth, Tailwind CSS
- **Déploiement :** Vercel (production depuis tags git, staging depuis dev)
- **État actuel :** App fonctionnelle avec auth, notes tree, éditeur. Webhook handler Stripe → Convex opérationnel (Phase 2 complète, vérifié en live via Stripe CLI). Checkout et pricing page livrés (Phase 3). Limite de 20 notes Free enforced server-side avec upgrade modal (Phase 4 complète, vérifié en live). Système de crédits IA complet (Phase 5 complète, vérifié en live) : bouton d'action IA dans le toolbar éditeur (placeholder — pas d'appel LLM réel ce phase, machine de crédit réelle), badge de solde réactif, dialogue de blocage à 0 crédit avec CTA selon le plan, top-up Stripe one-time (+50 crédits). Page Settings in-app livrée (Phase 6 complète, vérifié en live via Stripe CLI test-mode) : plan/renouvellement/statut, upgrade CTA, annulation avec confirmation (`AlertDialog`) sans perte d'accès immédiate, reprise d'abonnement, solde crédits + historique des top-ups — Phase 6 était la dernière phase du roadmap v1.0 initial. Phase 06.1 (gap-closure) a fermé un BLOCKER trouvé par l'audit milestone v1.0 : un nouveau abonné Pro recevait 0 crédit IA jusqu'à son premier renouvellement mensuel — `grantInitialCredits` accorde maintenant les 100 crédits dès la confirmation du `checkout.session.completed` (mode abonnement), avec une clé d'idempotence distincte pour éviter une collision silencieuse avec `upsertSubscription`.
- **Paiements :** Webhook handler Stripe (`app/api/webhooks/stripe/route.ts` → `convex/stripeWebhooks.ts`) écrit `subscriptions`/`aiCredits`/`creditTransactions`/`processedStripeEvents` de façon idempotente.
- **Erreurs Convex client-inspectées :** toute erreur Convex qu'un composant client doit inspecter (pas seulement logger) DOIT être un `ConvexError(data)`, jamais un `Error` brut — un `Error` brut voit son `.message` redacted à la frontière client/serveur réelle, alors que `ConvexError.data` survit. Établi Phase 3 (webhook auth) et re-confirmé Phase 4 (note-limit gap-closure, `f2a7f06`).

## Constraints

- **Tech stack :** Next.js + Convex — les webhooks Stripe doivent être des routes API Next.js
- **Auth :** Clerk gère l'identité — le `userId` Clerk doit être lié à l'abonnement Stripe
- **Temps réel :** Convex est le store de vérité pour le statut d'abonnement, Stripe est la source d'autorité
- **Sécurité :** Webhook signature verification obligatoire (Stripe-Signature header)

## Key Decisions

| Decision                              | Rationale                                                   | Outcome                                                    |
| ------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Stripe comme provider                 | Maturité, webhooks robustes, support abonnements + one-time | ✓ Confirmé — Phase 2                                       |
| UI custom (pas Stripe Portal)         | Meilleure cohérence UX dans l'app                           | ✓ Confirmé — Phase 6 (Settings page)                       |
| Convex pour stocker statut abonnement | Temps réel, cohérent avec le reste du stack                 | ✓ Confirmé — Phase 2                                       |
| Modèle hybride Free/Pro + crédits     | Monétisation flexible : récurrent + usage IA                | ✓ Confirmé — Phase 2 (reset), Phase 5 (déduction + top-up) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-10-16 — v1.1 (marketplace) et v1.2 (pricing/social) fusionnés_
