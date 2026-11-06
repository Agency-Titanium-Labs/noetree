import { common, createLowlight } from "lowlight";

export const lowlight = createLowlight(common);

export interface CodeLanguageOption {
  label: string;
  value: string;
}

export const CODE_LANGUAGES: CodeLanguageOption[] = [
  { label: "Auto", value: "" },
  { label: "TypeScript", value: "typescript" },
  { label: "JavaScript", value: "javascript" },
  { label: "Python", value: "python" },
  { label: "HTML / XML", value: "xml" },
  { label: "CSS", value: "css" },
  { label: "SCSS", value: "scss" },
  { label: "JSON", value: "json" },
  { label: "YAML", value: "yaml" },
  { label: "Markdown", value: "markdown" },
  { label: "Bash / Shell", value: "bash" },
  { label: "SQL", value: "sql" },
  { label: "Rust", value: "rust" },
  { label: "Go", value: "go" },
  { label: "C++", value: "cpp" },
  { label: "C#", value: "csharp" },
  { label: "C", value: "c" },
  { label: "Java", value: "java" },
  { label: "Kotlin", value: "kotlin" },
  { label: "Swift", value: "swift" },
  { label: "PHP", value: "php" },
  { label: "Ruby", value: "ruby" },
  { label: "GraphQL", value: "graphql" },
  { label: "Diff", value: "diff" },
  { label: "Plain Text", value: "plaintext" },
];
