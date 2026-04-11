import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve built React frontend (used in Railway / production deployments)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : path.resolve(__dirname, "public");

if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    const indexPath = path.join(staticDir, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: "Not found" });
    }
  });
  logger.info({ staticDir }, "Serving static frontend");
}

export default app;
