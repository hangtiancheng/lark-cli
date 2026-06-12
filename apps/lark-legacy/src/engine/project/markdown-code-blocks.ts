import { lexer, type Token, type Tokens } from "marked";

export type MarkdownCodeBlock = Readonly<{
  body: string;
  language: string;
  meta: string;
}>;

const isFencedCodeToken = (token: Token): token is Tokens.Code =>
  token.type === "code" && token.codeBlockStyle !== "indented";

const parseFenceInfo = (info: string | undefined): Readonly<{ language: string; meta: string }> => {
  const [language = "", ...metaParts] = (info ?? "").trim().split(" ");
  return { language, meta: metaParts.join(" ") };
};

export const extractMarkdownCodeBlocks = (content: string): readonly MarkdownCodeBlock[] =>
  lexer(content)
    .filter(isFencedCodeToken)
    .map((token) => {
      const { language, meta } = parseFenceInfo(token.lang);
      return { body: token.text, language, meta };
    });
