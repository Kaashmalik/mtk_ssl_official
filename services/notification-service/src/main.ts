import './env';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { NotificationModule } from './notification.module';

async function bootstrap() {
  const logger = new Logger('NotificationService');

  // HTTP Server for webhooks
  const app = await NestFactory.create(NotificationModule);
  app.use(helmet());

  // Connect Kafka consumer
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'notification-service',
        brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
      },
      consumer: {
        groupId: 'notification-consumer',
      },
    },
  });

  await app.startAllMicroservices();

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4008;
  await app.listen(port);

  logger.log(`Notification Service running on port ${port}`);
  logger.log('Kafka consumer connected');
}

bootstrap();
