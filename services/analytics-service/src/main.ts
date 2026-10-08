import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import helmet from 'helmet';
import { AnalyticsModule } from './analytics.module';

async function bootstrap() {
  const app = await NestFactory.create(AnalyticsModule);

  app.use(helmet());

  const isProd = (process.env.NODE_ENV ?? 'development') === 'production';
  const allowlist = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*');

  // Never reflect arbitrary origins with credentials: production without an
  // explicit allowlist denies CORS entirely; dev allows localhost.
  const origin =
    allowlist.length > 0 ? allowlist : isProd ? false : true;

  app.enableCors({ origin, credentials: true });

  // Kafka consumer for ball events -> ClickHouse
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: { clientId: 'analytics-service', brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'] },
      consumer: { groupId: 'analytics-consumer' },
    },
  });

  await app.startAllMicroservices();
  const port = process.env.PORT || 5003;
  await app.listen(port);
  console.log(`Analytics service running on port ${port}`);
}
bootstrap();
