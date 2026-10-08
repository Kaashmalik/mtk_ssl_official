import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const serviceName = process.env.OTEL_SERVICE_NAME || "ssl-api";
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

let sdk: NodeSDK | null = null;

if (otlpEndpoint) {
  const traceExporter = new OTLPTraceExporter({
    url: otlpEndpoint,
  });

  sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
    }),
    traceExporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  // Gracefully shut down SDK on process termination
  process.on("SIGTERM", () => {
    sdk?.shutdown()
      .then(() => console.log("Tracing terminated"))
      .catch((error) => console.error("Error terminating tracing", error))
      .finally(() => process.exit(0));
  });

  console.log(`📡 OpenTelemetry tracing initialized for service: ${serviceName} targeting ${otlpEndpoint}`);
} else {
  console.log("📡 OpenTelemetry tracing is disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)");
}

export function startTracing() {
  if (sdk) {
    sdk.start();
  }
}
