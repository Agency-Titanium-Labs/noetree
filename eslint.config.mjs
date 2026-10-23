import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// pnpm (>=10) no longer hoists eslint plugins to the project root, so the
// plugins required by eslint-config-next can't be resolved from here. Resolve
// them from pnpm's hoisted virtual store when present (falls back to the root
// for npm/yarn installs).
const pnpmHoisted = join(__dirname, "node_modules", ".pnpm", "node_modules");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: existsSync(pnpmHoisted) ? pnpmHoisted : __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".worktrees/**",
      ".claude/**",
      ".agents/**",
      "convex/_generated/**",
      "node_modules/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
