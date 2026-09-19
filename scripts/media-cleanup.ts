import "dotenv/config";
import { prisma } from "../src/lib/db/client";
import { cleanupMedia } from "../src/modules/media/cleanup";

async function main() {
  const args = process.argv.slice(2);
  const businessId = args[args.indexOf("--business") + 1];
  const userId = args[args.indexOf("--actor") + 1];
  if (!args.includes("--business") || !args.includes("--actor"))
    throw new Error(
      "Usage: npm run media:cleanup -- --business UUID --actor USER_UUID [--apply] [--include-unused]",
    );
  const user = await prisma.user.findFirst({
    where: { id: userId, businessId },
    select: { id: true, email: true },
  });
  if (!user) throw new Error("Choose an audit actor belonging to the business");
  console.table(
    await cleanupMedia(
      { businessId: businessId!, userId: user.id, actorLabel: user.email },
      {
        apply: args.includes("--apply"),
        includeUnused: args.includes("--include-unused"),
      },
    ),
  );
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
