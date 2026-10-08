import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { StreamingModule } from './streaming.module';
import { env } from './env';

async function bootstrap() {
  const app = await NestFactory.create(StreamingModule);
  app.enableCors({ origin: env.CORS_ORIGIN.split(','), credentials: true });

  // Kafka consumer for streaming commands
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'streaming-service',
        brokers: env.KAFKA_BROKERS.split(','),
      },
      consumer: { groupId: 'streaming-consumer' },
    },
  });

  await app.startAllMicroservices();
  await app.listen(env.PORT);
  console.log(`Streaming service running on port ${env.PORT} in ${env.NODE_ENV}`);
}

bootstrap();
