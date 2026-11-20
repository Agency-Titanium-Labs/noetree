This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Commandes d'administration (CLI Convex)

### Arbres partagés par défaut (ex. Feedbacks Beta)

Permet de désigner un arbre racine (par exemple `🚀 Feedbacks Beta`) pour qu'il soit automatiquement partagé avec **tous les utilisateurs** (comptes existants et nouveaux arrivants) avec le rôle **`contributor`** (lecture, commentaires, création et modification de leurs propres sous-notes).

L'ID de la note se trouve directement dans l'URL de votre navigateur lorsque vous visualisez la note :  
`https://noetree.com/notes/<ID_DE_LA_NOTE>`

```bash
# Activer le partage par défaut pour un arbre (remplacer par l'ID de votre note racine) :
npx convex run admin:setDefaultSharedTree '{"noteId": "<ID_DE_LA_NOTE>"}'

# Spécifier un autre rôle si besoin (contributor par défaut, ou view, edit) :
npx convex run admin:setDefaultSharedTree '{"noteId": "<ID_DE_LA_NOTE>", "role": "contributor"}'

# Pour exécuter sur le déploiement de production, ajouter le flag --prod :
npx convex run admin:setDefaultSharedTree '{"noteId": "<ID_DE_LA_NOTE>"}' --prod

# Lister les arbres par défaut actifs :
npx convex run admin:listDefaultSharedTrees
# En production :
npx convex run admin:listDefaultSharedTrees --prod

# Désactiver le partage par défaut d'un arbre :
npx convex run admin:setDefaultSharedTree '{"noteId": "<ID_DE_LA_NOTE>", "enabled": false}'
# En production :
npx convex run admin:setDefaultSharedTree '{"noteId": "<ID_DE_LA_NOTE>", "enabled": false}' --prod
```
