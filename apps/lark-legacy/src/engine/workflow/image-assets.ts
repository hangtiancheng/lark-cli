import { z } from "zod";

export const imageCategorySchema = z.enum(["ARCHITECTURE", "CONTENT", "ILLUSTRATION", "LOGO"]);

export const imageResourceSchema = z.object({
  category: imageCategorySchema,
  description: z.string().min(1).max(512),
  url: z.string().url(),
});

export const imageResourceListSchema = z.array(imageResourceSchema).max(64);

export type ImageCategory = z.infer<typeof imageCategorySchema>;
export type ImageResource = z.infer<typeof imageResourceSchema>;

const categoryLabel = (category: ImageCategory): string => {
  switch (category) {
    case "ARCHITECTURE":
      return "Architecture diagram";
    case "CONTENT":
      return "Content image";
    case "ILLUSTRATION":
      return "Illustration";
    case "LOGO":
      return "Logo";
  }
};

export const appendImageResourcesToPrompt = (
  prompt: string,
  resources: readonly ImageResource[],
): string => {
  const parsed = imageResourceListSchema.parse(resources);
  if (parsed.length === 0) return prompt;
  const lines = parsed.map((r) => `- ${categoryLabel(r.category)}: ${r.description} (${r.url})`);
  return `${prompt}\n\n## Available Visual Assets\nUse these visual assets where they fit the generated website:\n${lines.join("\n")}`;
};

export const parseImageArgs = (raw: string[]): ImageResource[] => {
  const resources: ImageResource[] = [];
  for (const item of raw) {
    const parts = item.split(",");
    if (parts.length < 2) continue;
    const url = parts[0]!.trim();
    const description = parts.slice(1).join(",").trim();
    const category = inferCategory(url, description);
    resources.push({ category, description, url });
  }
  return resources;
};

const inferCategory = (_url: string, description: string): ImageCategory => {
  const lower = description.toLowerCase();
  if (lower.includes("logo")) return "LOGO";
  if (lower.includes("diagram") || lower.includes("architecture")) return "ARCHITECTURE";
  if (lower.includes("illustration") || lower.includes("icon")) return "ILLUSTRATION";
  return "CONTENT";
};
