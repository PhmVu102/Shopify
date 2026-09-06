import { createRequire } from "node:module";
import { PrismaClient as BasePrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: BasePrismaClient;
}

function instantiatePrisma(): BasePrismaClient {
  try {
    const req = createRequire(import.meta.url);
    if (req.cache) {
      Object.keys(req.cache).forEach((key) => {
        if (key.includes(".prisma") || key.includes("@prisma")) {
          delete req.cache[key];
        }
      });
    }
    const { PrismaClient } = req("@prisma/client");
    return new PrismaClient();
  } catch {
    return new BasePrismaClient();
  }
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal || !(global.prismaGlobal as any).productVector) {
    global.prismaGlobal = instantiatePrisma();
  }
}

const prisma = global.prismaGlobal ?? instantiatePrisma();

export default prisma;
