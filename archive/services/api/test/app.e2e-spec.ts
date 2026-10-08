import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("AppController (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("/api/health (GET)", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/health")
      .expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      service: "SSL API",
    });
    expect(response.body.timestamp).toBeDefined();
  });
});