import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 这些包含原生/二进制依赖或动态 require,不应被 webpack 打包
  serverExternalPackages: [
    "@zilliz/milvus2-sdk-node",
    "@grpc/grpc-js",
    "@grpc/proto-loader",
    "mysql2",
    "knex",
  ],
};

export default nextConfig;
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
