import { PrismaClient } from "@prisma/client";
import { VIEW_ONLY_HEADER, ViewOnlyError, isWriteOperation } from "@/lib/view-as";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Whether the request being served is an administrator's read-only look at a learner (see lib/view-as.ts). */
async function viewOnlyRequest(): Promise<boolean> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get(VIEW_ONLY_HEADER) === "1";
  } catch {
    // Outside a web request (a script, a test): nothing is being viewed.
    return false;
  }
}

// Typed as a plain PrismaClient on purpose: the extension below only guards, it adds no models or methods,
// and the extended type does not fit the Prisma.TransactionClient the helpers take.
function create(): PrismaClient {
  return new PrismaClient().$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          // The last line of defence: whatever a page, action or route tries, a view-only request cannot write.
          if (isWriteOperation(operation) && await viewOnlyRequest()) throw new ViewOnlyError();
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

export const db = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
