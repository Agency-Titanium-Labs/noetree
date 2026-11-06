"use client";

import { useState } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { Code2, WrapText } from "lucide-react";
import { useTranslations } from "next-intl";
import { CODE_LANGUAGES } from "@/lib/editor/lowlight";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const AUTO_LANG = "auto";

export default function CodeBlockComponent({
  node,
  updateAttributes,
  editor,
}: NodeViewProps) {
  const t = useTranslations("Editor.codeBlock");
  const [wrap, setWrap] = useState(false);
  const currentLanguage = (node?.attrs?.language as string) || "";
  const isEditable = editor?.isEditable ?? true;

  const handleLanguageChange = (val: string) => {
    updateAttributes({ language: val === AUTO_LANG ? null : val });
  };

  const currentLabel =
    CODE_LANGUAGES.find(l => l.value === currentLanguage)?.label ||
    currentLanguage ||
    t("auto");

  return (
    <NodeViewWrapper className="code-block-wrapper my-4">
      <CodeBlock>
        <CodeBlockHeader contentEditable={false}>
          <CodeBlockTitle>
            <Code2 className="size-3.5 opacity-70" />
            {isEditable ? (
              <Select
                value={currentLanguage || AUTO_LANG}
                onValueChange={handleLanguageChange}
              >
                <SelectTrigger size="sm" aria-label={t("selectLanguage")}>
                  <SelectValue placeholder={t("auto")} />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={AUTO_LANG}>{t("auto")}</SelectItem>
                  {CODE_LANGUAGES.filter(lang => lang.value !== "").map(
                    lang => (
                      <SelectItem key={lang.value} value={lang.value}>
                        {lang.label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            ) : (
              <span className="font-sans text-xs">{currentLabel}</span>
            )}
          </CodeBlockTitle>

          <CodeBlockActions>
            <CodeBlockCopyButton
              value={node?.textContent || ""}
              copyLabel={t("copy")}
              copiedLabel={t("copied")}
            />
          </CodeBlockActions>
        </CodeBlockHeader>

        <CodeBlockContent wrap={wrap}>
          <NodeViewContent<"code">
            as="code"
            className={
              currentLanguage ? `language-${currentLanguage}` : undefined
            }
          />
        </CodeBlockContent>
      </CodeBlock>
    </NodeViewWrapper>
  );
}
