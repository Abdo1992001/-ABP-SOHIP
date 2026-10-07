import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { assertProductionConfiguration } from "./security/production-config.js";

async function bootstrap(): Promise<void> {
  assertProductionConfiguration();
  const app = await NestFactory.create(AppModule, {
    cors: false,
    bodyParser: false,
  });
  configureHttpApplication(app);
  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
}

void bootstrap();
