// Centralize environment variable reading, replacing the source project's GoFrame g.Cfg().
// Next.js automatically loads .env / .env.local; importing dotenv/config here serves as a safeguard (for script scenarios).
import "dotenv/config";

export const config = {
  // DeepSeek (Volcano engine Ark, OpenAI compatible). 'think' is used for planning/replanning, 'quick' is used for execution/chat.
  deepseek: {
    think: {
      model: process.env.DEEPSEEK_THINK_MODEL ?? "deepseek-v3-2-251201",
      apiKey: process.env.DEEPSEEK_THINK_API_KEY ?? "",
      baseURL: process.env.DEEPSEEK_THINK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
    },
    quick: {
      model: process.env.DEEPSEEK_QUICK_MODEL ?? "deepseek-v3-2-251201",
      apiKey: process.env.DEEPSEEK_QUICK_API_KEY ?? "",
      baseURL: process.env.DEEPSEEK_QUICK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
    },
  },
  // Alibaba Bailian DashScope embedding (OpenAI compatible)
  dashscope: {
    model: process.env.DASHSCOPE_EMBEDDING_MODEL ?? "text-embedding-v4",
    apiKey: process.env.DASHSCOPE_API_KEY ?? "",
    baseURL: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  // Milvus
  milvus: {
    address: process.env.MILVUS_ADDRESS ?? "localhost:19530",
    db: process.env.MILVUS_DB ?? "agent",
    collection: process.env.MILVUS_COLLECTION ?? "biz",
  },
  // MCP (Log tool SSE)
  mcpUrl: process.env.MCP_URL ?? "http://localhost:3000/sse",
  // File upload directory
  fileDir: process.env.FILE_DIR ?? "./data/docs",
  // Prometheus
  prometheusBaseUrl: process.env.PROMETHEUS_BASE_URL ?? "http://127.0.0.1:9090",
} as const;

// Milvus field names (aligned with source project utility/common + indexer fields)
export const MILVUS_FIELDS = {
  id: "id",
  vector: "vector",
  content: "content",
  metadata: "metadata",
} as const;

// dashscope text-embedding-v4 returns 2048-dimensional float32
export const EMBEDDING_DIM = 2048;
// The source project stores the raw bytes of 2048 float32s (2048*4=8192 bytes=65536 bits) as a BinaryVector
// Hence BinaryVector dim = 65536, bytes = 8192, metric = HAMMING
export const BINARY_VECTOR_DIM = 65536;
export const BINARY_VECTOR_BYTES = BINARY_VECTOR_DIM / 8; // 8192

// Conversation memory window size (aligned with source project utility/mem MaxWindowSize)
export const MEMORY_WINDOW_SIZE = 6;
