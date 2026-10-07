import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
} from "@nestjs/common";
import { PlatformProofService } from "./platform-proof.service.js";

@Controller("_platform/proof")
export class PlatformProofController {
  constructor(
    @Inject(PlatformProofService) private readonly proof: PlatformProofService,
  ) {}

  @Post()
  @HttpCode(202)
  async start(
    @Headers("x-trace-id") traceId?: string,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<{
    data: {
      proofRunId: string;
      eventId: string;
      traceId: string;
      correlationId: string;
    };
  }> {
    if (process.env.ABP_PLATFORM_PROOF_ENABLED !== "true") {
      throw new NotFoundException();
    }
    return { data: await this.proof.start(traceId, correlationId) };
  }
}
