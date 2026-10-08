import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AnalyticsModule } from './analytics.module';

async function bootstrap() {
  const app = await NestFactory.create(AnalyticsModule);
  app.enableCors({ origin: true, credentials: true });

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
