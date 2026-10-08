import './env';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { join } from 'path';
import { PaymentModule } from './payment.module';

async function bootstrap() {
  const logger = new Logger('PaymentService');

  // Hybrid Application (HTTP + gRPC)
  const app = await NestFactory.create(PaymentModule, {
    rawBody: true,
  });

  // Connect gRPC Microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'payment',
      protoPath: join(__dirname, './proto/payment.proto'),
      url: '0.0.0.0:5004',
    },
  });

  await app.startAllMicroservices();
  await app.listen(5006);
  logger.log('📡 Payment Service running on HTTP port 5006');
  logger.log('💳 Payment Service running on gRPC port 5004');
}

bootstrap();
