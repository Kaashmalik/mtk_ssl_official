import './env';
import './instrument';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ScoringModule } from './scoring.module';

async function bootstrap() {
  // Create HTTP application
  const app = await NestFactory.create(ScoringModule);

  // Enable CORS for WebSocket connections
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
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
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.REDIS,
    options: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
  });

  // Start all microservices
  await app.startAllMicroservices();

  // Start HTTP server
  const port = process.env.PORT || 4000;
  await app.listen(port);

  console.log(`🏏 Scoring Service running on port ${port}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🔗 Kafka connected`);
  console.log(`⚡ Redis pub/sub connected`);
}

bootstrap();
