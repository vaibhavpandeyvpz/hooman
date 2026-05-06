export type PageFrontmatter = {
  title?: string;
  summary?: string;
  tags?: string[];
  related?: string[];
  type?: string;
  created?: string;
  updated?: string;
};

export type PageRecord = {
  path: string;
  absolutePath: string;
  title: string;
  summary: string;
  tags: string[];
  related: string[];
  type: string | null;
  created: string | null;
  updated: string | null;
  wordCount: number;
  mtime: string;
  content: string;
  body: string;
  frontmatter: PageFrontmatter;
};
