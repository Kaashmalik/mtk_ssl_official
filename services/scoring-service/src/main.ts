import './env';
import './instrument';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import helmet from 'helmet';
import { ScoringModule } from './scoring.module';
import { env, corsAllowlist } from './env';

async function bootstrap() {
  // Create HTTP application
  const app = await NestFactory.create(ScoringModule);

  app.use(helmet());

  // Enable CORS for WebSocket connections
  app.enableCors({
    origin: corsAllowlist(),
    credentials: true,
  });

  // Connect to Kafka for event-driven communication
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'scoring-service',
        brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
      },
      consumer: {
        groupId: 'scoring-consumer',
      },
    },
  });

  // Connect to Redis for pub/sub
  const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.REDIS,
    options: {
      host: process.env.REDIS_HOST || redisUrl.hostname,
      port: parseInt(process.env.REDIS_PORT || redisUrl.port || '6379'),
    },
  });

  // Start all microservices
  await app.startAllMicroservices();

  // Start HTTP server
  const port = env.PORT;
  await app.listen(port);

  console.log(`🏏 Scoring Service running on port ${port}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🔗 Kafka connected`);
  console.log(`⚡ Redis pub/sub connected`);
}

bootstrap();
