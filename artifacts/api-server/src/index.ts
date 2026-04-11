import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { papersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

// On startup, mark any papers stuck in "processing" as error
// (they were interrupted by a server restart)
async function cleanupStuckPapers() {
  try {
    const updated = await db
      .update(papersTable)
      .set({
        processingStatus: "error",
        processingError: "Processing was interrupted by a server restart. Please delete this paper and re-upload the PDF.",
      })
      .where(eq(papersTable.processingStatus, "processing"))
      .returning();
    if (updated.length > 0) {
      logger.warn({ count: updated.length }, "Marked stuck papers as error on startup");
    }
  } catch (err) {
    logger.warn({ err }, "Could not clean up stuck papers on startup");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  cleanupStuckPapers();
});
