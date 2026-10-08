import './env';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { TournamentModule } from './tournament.module';

async function bootstrap() {
  // Create gRPC microservice
  const grpcApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    TournamentModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'tournament',
        protoPath: join(__dirname, './proto/tournament.proto'),
        url: '0.0.0.0:5002',
      },
    },
  );

  // Connect to Kafka for event streaming
  const kafkaApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    TournamentModule,
    {
      transport: Transport.KAFKA,
      options: {
        client: {
          clientId: 'tournament-service',
          brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
        },
        consumer: {
          groupId: 'tournament-consumer',
        },
      },
    },
  );

  await Promise.all([grpcApp.listen(), kafkaApp.listen()]);
  
  console.log('🏆 Tournament Service running on gRPC port 5002');
  console.log('📡 Kafka consumer connected');
}

bootstrap();
