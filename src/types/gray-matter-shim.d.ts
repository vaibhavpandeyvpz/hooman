declare module "gray-matter" {
  type GrayMatterResult = {
    data?: Record<string, unknown>;
  };

  export default function matter(input: string): GrayMatterResult;
}
