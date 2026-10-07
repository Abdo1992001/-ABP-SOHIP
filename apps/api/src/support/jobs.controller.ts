import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import { JobsService } from "./jobs.service.js";

@Controller("jobs")
@UseGuards(CustomerIdentityGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get(":jobId")
  get(
    @Req() request: CustomerRequest,
    @Param("jobId", new ParseUUIDPipe()) id: string,
  ) {
    return this.jobs.get(request.customerIdentity, id);
  }
}
