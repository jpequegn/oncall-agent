import { createHandler } from "./handler";

const PORT = Number(process.env.PORT ?? 3001);
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/oncall_agent";

const { handle } = createHandler(DATABASE_URL);

const server = Bun.serve({ port: PORT, fetch: handle });
console.log(`🚀 service-graph API listening on http://localhost:${server.port}`);
