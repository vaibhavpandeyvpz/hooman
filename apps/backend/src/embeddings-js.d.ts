declare module "@themaximalist/embeddings.js" {
  interface EmbeddingsOptions {
    service?: "transformers" | "openai" | "mistral";
    model?: string;
    cache?: boolean;
    cache_file?: string;
  }
  function embeddings(
    input: string,
    options?: EmbeddingsOptions,
  ): Promise<number[]>;
  export default embeddings;
}
