import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "../src/app.module";

describe("OpenAPI contract (e2e)", () => {
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

  it("matches snapshot", () => {
    const config = new DocumentBuilder()
      .setTitle("SSL API")
      .setDescription("Shakir Super League API")
      .setVersion("2.0.0")
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    expect(document).toMatchSnapshot();
  });
});