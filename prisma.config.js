import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    adapter: {
      provider: "mysql",
      url: env("DATABASE_URL"),
    },
  },
});

