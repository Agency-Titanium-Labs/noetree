# Requirements: Noetree

**Defined:** 2026-10-19
**Core Value:** Un utilisateur peut créer, organiser et naviguer dans ses notes en structure arborescente — la navigation et la hiérarchie doivent toujours fonctionner.

## v1.3 Requirements — IA et TVA marketplace

### Fondation IA (AIF)

- [ ] **AIF-01**: Chaque action IA payante réserve ses crédits avant l'appel au LLM, une seule fois même si la requête est rejouée.
- [ ] **AIF-02**: Si l'appel LLM échoue ou est abandonné avant le premier jeton, les crédits sont remboursés une seule fois à leur origine.
- [ ] **AIF-03**: Une réservation restée bloquée est remboursée automatiquement par une tâche planifiée.
- [ ] **AIF-04**: Un utilisateur Free qui lance une action Premium reçoit `PREMIUM_REQUIRED` sans aucun débit, et voit une invitation à passer Premium.
- [ ] **AIF-05**: Le palier d'un utilisateur (`past_due`, Premium résilié) est calculé au même endroit pour l'accès, les crédits et la commission.
- [ ] **AIF-06**: Chaque appel IA est limité en débit par utilisateur, et un interrupteur permet de couper l'IA sans redéploiement.
- [ ] **AIF-07**: Le coût en crédits de chaque action est affiché avant son lancement (catalogue partagé UI/serveur).

### Contexte (CTX)

- [ ] **CTX-01**: L'IA peut recevoir la note courante, ses parents et ses enfants dans une limite de taille fixe.
- [ ] **CTX-02**: Une action dont le contexte dépasse la limite est refusée sans débit.
- [ ] **CTX-03**: Le contenu des notes est traité comme des données non fiables par l'IA.
- [ ] **CTX-04**: Les notes que l'utilisateur ne peut pas lire n'entrent jamais dans le contexte.
- [ ] **CTX-05**: Les notes achetées sur la marketplace sont exclues du contexte IA.

### Chat gratuit (CHAT)

- [ ] **CHAT-01**: L'utilisateur ouvre un chat dans l'éditeur et voit la réponse arriver en streaming (arrêter, copier, réessayer).
- [ ] **CHAT-02**: Il choisit le contexte : aucun, ou note courante + parents + enfants, et voit ce qui est envoyé.
- [ ] **CHAT-03**: Il voit les états « crédits insuffisants », « erreur » et « crédit remboursé ».
- [ ] **CHAT-04**: Les réponses suivent la langue de l'interface. L'historique n'est pas conservé après la session.

### Premium : contexte et arborescence (TREE)

- [ ] **TREE-01**: Un utilisateur Premium peut enregistrer, modifier et supprimer son contexte personnel, utilisé pour personnaliser la génération.
- [ ] **TREE-02**: L'IA reçoit le plan de toute l'arborescence (titres et courts extraits) et peut lire une note à la demande.
- [ ] **TREE-03**: L'IA propose un arbre de nouveaux nœuds, que l'utilisateur prévisualise et coche avant application.
- [ ] **TREE-04**: L'application crée tous les nœuds acceptés en une seule opération atomique, et uniquement sous des nœuds modifiables.
- [ ] **TREE-05**: L'utilisateur peut annuler tout un lot de nœuds créés par l'IA.

### Premium : autocomplétion (AUTO)

- [ ] **AUTO-01**: Un utilisateur Premium voit une suggestion en texte fantôme dans l'éditeur, acceptée avec Tab et refusée avec Échap.
- [ ] **AUTO-02**: Une suggestion affichée est gratuite ; 1 crédit est débité une seule fois à l'acceptation.
- [ ] **AUTO-03**: Les demandes de suggestion sont limitées en débit, et le nombre de suggestions non résolues est plafonné.

### Premium : liens entre notes (LINK)

- [ ] **LINK-01**: Un utilisateur Premium lance une analyse qui suggère des liens entre notes, avec la justification de chacun.
- [ ] **LINK-02**: Il accepte ou ignore chaque suggestion ; aucun lien n'est ajouté automatiquement.
- [ ] **LINK-03**: Les suggestions privilégient les notes d'autres branches, et les liens acceptés sont conservés.
- [ ] **LINK-04**: Supprimer une note supprime ses embeddings, ses liens et ses suggestions.

### Marketplace TVA (VAT)

- [ ] **VAT-01**: La décision TVA (base de calcul, taux, Stripe Tax) est consignée avec l'avis d'un comptable avant l'implémentation.
- [ ] **VAT-02**: L'acheteur paie exactement le prix affiché, sans TVA ajoutée.
- [ ] **VAT-03**: La part du vendeur est calculée en centimes entiers : prix = TVA + commission + net vendeur, vérifié par un test de propriété.
- [ ] **VAT-04**: Le vendeur voit le détail (brut, TVA, commission, net) avant de publier une annonce et dans ses ventes.
- [ ] **VAT-05**: Les achats déjà faits en v1.1 gardent leurs montants d'origine.
- [ ] **VAT-06**: Un achat de test par environnement confirme que le prélèvement correspond au calcul.

## Future Requirements

- Historique de chat conservé entre sessions
- Embeddings à chaque sauvegarde (au lieu de paresseux)
- Seuils d'alerte « crédits bas »
- TVA par pays de l'acheteur (OSS) et TVA intracommunautaire B2B
- Remboursement / litige TVA automatisés (runbook manuel en v1.3)

## Out of Scope

| Feature                                             | Reason                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| IA qui modifie des notes existantes sans validation | Écritures destructrices ; seules des créations proposées puis confirmées sont permises |
| Application automatique des liens suggérés          | L'utilisateur garde le contrôle (LINK-02)                                              |
| Envoi des notes achetées au LLM                     | Protège le contenu des vendeurs (CTX-05)                                               |
| IA collaborative / co-édition                       | Milestone future avec la collaboration temps réel                                      |
| Docs légaux et RGPD (NOETREE-24/25/26/32/33)        | Pris en charge par Antoine ; dépendance de lancement pour le fournisseur d'IA          |
| Stripe Tax                                          | Réévalué dans VAT-01 ; probablement inutile avec une TVA absorbée                      |

## Traceability

| Requirement       | Phase    | Status  |
| ----------------- | -------- | ------- |
| AIF-01 … AIF-07   | Phase 17 | Pending |
| CTX-01 … CTX-05   | Phase 18 | Pending |
| CHAT-01 … CHAT-04 | Phase 19 | Pending |
| TREE-01 … TREE-05 | Phase 20 | Pending |
| AUTO-01 … AUTO-03 | Phase 21 | Pending |
| LINK-01 … LINK-04 | Phase 22 | Pending |
| VAT-01 … VAT-06   | Phase 23 | Pending |

**Coverage:**

- v1.3 requirements: 34 total
- Mapped to phases: 34 (7 + 5 + 4 + 5 + 3 + 4 + 6)
- Unmapped: 0

---

_Requirements defined: 2026-10-19_
