import { writeFile } from "node:fs/promises";
import { createPrismaClient } from "@abp/database";
import { officialQuotationHtml } from "./workflow-handlers.js";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: tsx preview-quotation.ts <quotationId>");
  const quote = await db.quotation.findUniqueOrThrow({
    where: { id },
    include: {
      account: { include: { country: true } },
      project: true,
      owner: { include: { profile: true } },
      // The same as the issued document, so the preview shows each line's
      // item code and photo rather than a thinner version of it.
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          product: {
            include: {
              productImages: { where: { isPrimary: true }, take: 1 },
            },
          },
        },
      },
    },
  });
  const html = officialQuotationHtml(quote);
  await writeFile("preview.html", html, "utf8");
  console.log("wrote preview.html");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
