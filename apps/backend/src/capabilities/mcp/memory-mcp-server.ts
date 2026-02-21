#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ChromaVectorStore,
  HFEmbeddingProvider,
  createServer,
} from "@one710/consciousness";
import { ChromaClient } from "chromadb";

const embeddingProvider = new HFEmbeddingProvider();
const chromaUrl = process.env.CHROMA_URL || "http://localhost:8000";
const collectionName = process.env.CHROMA_COLLECTION || "hooman-memory";

const client = new ChromaClient({ path: chromaUrl });
const vectorStore = new ChromaVectorStore(
  embeddingProvider,
  client,
  collectionName,
);

const server = createServer("consciousness", "1.0.0", vectorStore);
const transport = new StdioServerTransport();
await server.connect(transport);
