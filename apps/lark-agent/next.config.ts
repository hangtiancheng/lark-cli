import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/binary deps with dynamic requires should not be bundled by webpack.
  serverExternalPackages: [
    "@zilliz/milvus2-sdk-node",
    "@grpc/grpc-js",
    "@grpc/proto-loader",
    "mysql2",
    "knex",
  ],
};

export default nextConfig;
