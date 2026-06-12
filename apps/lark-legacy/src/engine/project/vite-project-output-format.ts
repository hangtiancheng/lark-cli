const unquote = (value: string): string => {
  const first = value.at(0);
  const last = value.at(-1);
  return first === last && (first === '"' || first === "'") ? value.slice(1, -1) : value;
};

export const filenameFromFence = (language: string, meta: string): string | undefined => {
  const source = `${language} ${meta}`.trim();
  for (const segment of source.split(" ")) {
    const normalizedSegment = segment.toLowerCase();
    for (const key of ["file", "filename", "path"]) {
      const prefix = `${key}=`;
      if (normalizedSegment.startsWith(prefix)) {
        return unquote(segment.slice(prefix.length));
      }
    }
  }
  return undefined;
};

export const hasUnsupportedFileWriteOutput = (content: string): boolean =>
  content.includes("FileWrite") ||
  content.includes("assistant-file-write") ||
  content.includes("filepath:");
