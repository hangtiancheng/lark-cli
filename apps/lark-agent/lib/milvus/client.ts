// Corresponds to the source project's utility/client/client.go
// Singleton MilvusClient + auto creates database (agent), collection (biz), index, and loads
import {
  MilvusClient,
  DataType,
  MetricType,
  IndexType,
  type FieldType,
} from "@zilliz/milvus2-sdk-node";
import { config, MILVUS_FIELDS, BINARY_VECTOR_DIM } from "@/lib/config";

// Field schema, aligned with the fields in utility/client/client.go of the source project
const fields: FieldType[] = [
  {
    name: MILVUS_FIELDS.id,
    data_type: DataType.VarChar,
    is_primary_key: true,
    type_params: { max_length: 256 },
  },
  {
    name: MILVUS_FIELDS.vector,
    data_type: DataType.BinaryVector,
    type_params: { dim: BINARY_VECTOR_DIM }, // 65536 bits → 8192 bytes
  },
  {
    name: MILVUS_FIELDS.content,
    data_type: DataType.VarChar,
    type_params: { max_length: 8192 },
  },
  {
    name: MILVUS_FIELDS.metadata,
    data_type: DataType.JSON,
  },
];

let clientPromise: Promise<MilvusClient> | null = null;

export function getMilvusClient(): Promise<MilvusClient> {
  if (!clientPromise) clientPromise = initClient();
  return clientPromise;
}

async function initClient(): Promise<MilvusClient> {
  const client = new MilvusClient({
    address: config.milvus.address,
    logLevel: "warn",
  });

  // 1. Check if the 'agent' database exists; create it if not
  const dbRes = await client.listDatabases();
  const dbNames = dbRes.db_names ?? [];
  if (!dbNames.includes(config.milvus.db)) {
    await client.createDatabase({ db_name: config.milvus.db });
  }

  // 2. Switch to the 'agent' database
  await client.use({ db_name: config.milvus.db });

  // 3. Check if the collection exists; if not, create it and build the index
  const hasRes = await client.hasCollection({
    collection_name: config.milvus.collection,
  });
  if (!hasRes.value) {
    await client.createCollection({
      collection_name: config.milvus.collection,
      fields,
    });
    // Vector field: AUTOINDEX + HAMMING (aligned with the source project)
    await client.createIndex({
      collection_name: config.milvus.collection,
      field_name: MILVUS_FIELDS.vector,
      index_type: IndexType.AUTOINDEX,
      metric_type: MetricType.HAMMING,
    });
  }

  // 4. Load the collection (must be loaded before searching)
  await client.loadCollection({ collection_name: config.milvus.collection });

  return client;
}
