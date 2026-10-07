import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import {
  CommitImportDto,
  CreateImportJobDto,
  CreateItemMappingDto,
  CreateReconciliationRunDto,
  ImportListQuery,
  DataQualityListQuery,
  ReconciliationListQuery,
  ResolveIssueDto,
  ResolveItemDto,
  ResolveReconciliationIssueDto,
  RetryImportDto,
  RollbackImportDto,
  UploadImportQuery,
  ValidateImportDto,
} from "./import.dto.js";
import { ImportService } from "./import.service.js";

@Controller("import-jobs")
@UseGuards(CustomerIdentityGuard)
export class ImportController {
  constructor(private readonly imports: ImportService) {}
  @Post() create(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateImportJobDto,
  ) {
    return this.imports.create(r.customerIdentity, k, b);
  }
  @Get() list(@Req() r: CustomerRequest, @Query() q: ImportListQuery) {
    return this.imports.list(r.customerIdentity, q);
  }
  @Get(":jobId") get(
    @Req() r: CustomerRequest,
    @Param("jobId", new ParseUUIDPipe()) id: string,
  ) {
    return this.imports.get(r.customerIdentity, id);
  }
  @Get(":jobId/rows") rows(
    @Req() r: CustomerRequest,
    @Param("jobId", new ParseUUIDPipe()) id: string,
    @Query() q: ImportListQuery,
  ) {
    return this.imports.rows(r.customerIdentity, id, q);
  }
  @Get(":jobId/issues") issues(
    @Req() r: CustomerRequest,
    @Param("jobId", new ParseUUIDPipe()) id: string,
    @Query() q: ImportListQuery,
  ) {
    return this.imports.issues(r.customerIdentity, id, q);
  }
  @Post(":jobId/file") @HttpCode(200) uploadFile(
    @Req() r: CustomerRequest,
    @Param("jobId", new ParseUUIDPipe()) id: string,
    @Query() q: UploadImportQuery,
    @Body() body: Buffer,
  ) {
    return this.imports.ingestBuffer(
      r.customerIdentity,
      id,
      body,
      q.parserVersion,
      q.mappingVersion,
    );
  }
  @Post(":jobId/validate") @HttpCode(202) validate(
    @Req() r: CustomerRequest,
    @Param("jobId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: ValidateImportDto,
  ) {
    return this.imports.validate(r.customerIdentity, id, k, b);
  }
  @Post(":jobId/commit") @HttpCode(200) commit(
    @Req() r: CustomerRequest,
    @Param("jobId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CommitImportDto,
  ) {
    return this.imports.commit(r.customerIdentity, id, k, b);
  }
  @Post(":jobId/retry") @HttpCode(200) retry(
    @Req() r: CustomerRequest,
    @Param("jobId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: RetryImportDto,
  ) {
    return this.imports.retry(r.customerIdentity, id, k, b);
  }
  @Post(":jobId/rollback") @HttpCode(200) rollback(
    @Req() r: CustomerRequest,
    @Param("jobId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: RollbackImportDto,
  ) {
    return this.imports.rollback(r.customerIdentity, id, k, b);
  }
}

@Controller("data-quality/issues")
@UseGuards(CustomerIdentityGuard)
export class DataQualityController {
  constructor(private readonly imports: ImportService) {}
  @Get() list(@Req() r: CustomerRequest, @Query() q: DataQualityListQuery) {
    return this.imports.globalIssues(r.customerIdentity, q);
  }
  @Post(":issueId/resolve") @HttpCode(200) async resolve(
    @Req() r: CustomerRequest,
    @Param("issueId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Headers("if-match") m: string | undefined,
    @Body() b: ResolveIssueDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.imports.resolveIssue(
      r.customerIdentity,
      id,
      k,
      m,
      b,
    );
    response.setHeader("ETag", result.etag);
    return { data: result.data };
  }
}

@Controller("reconciliation-runs")
@UseGuards(CustomerIdentityGuard)
export class ReconciliationController {
  constructor(private readonly imports: ImportService) {}
  @Get() list(@Req() r: CustomerRequest, @Query() q: ReconciliationListQuery) {
    return this.imports.listReconciliations(r.customerIdentity, q);
  }
  @Post() @HttpCode(202) create(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateReconciliationRunDto,
  ) {
    return this.imports.createReconciliation(r.customerIdentity, k, b);
  }
  @Get(":runId") get(
    @Req() r: CustomerRequest,
    @Param("runId", new ParseUUIDPipe()) id: string,
  ) {
    return this.imports.getReconciliation(r.customerIdentity, id);
  }
  @Get(":runId/issues") issues(
    @Req() r: CustomerRequest,
    @Param("runId", new ParseUUIDPipe()) id: string,
    @Query() q: ImportListQuery,
  ) {
    return this.imports.reconciliationIssues(r.customerIdentity, id, q);
  }
}

@Controller("reconciliation-issues")
@UseGuards(CustomerIdentityGuard)
export class ReconciliationIssueController {
  constructor(private readonly imports: ImportService) {}
  @Post(":issueId/resolve") @HttpCode(200) async resolve(
    @Req() r: CustomerRequest,
    @Param("issueId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Headers("if-match") m: string | undefined,
    @Body() b: ResolveReconciliationIssueDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.imports.resolveReconciliationIssue(
      r.customerIdentity,
      id,
      k,
      m,
      b,
    );
    response.setHeader("ETag", result.etag);
    return { data: result.data };
  }
}

@Controller("item-resolver")
@UseGuards(CustomerIdentityGuard)
export class ItemResolverController {
  constructor(private readonly imports: ImportService) {}
  @Post("resolve") @HttpCode(200) resolve(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: ResolveItemDto,
  ) {
    return this.imports.resolveItem(r.customerIdentity, k, b);
  }
  @Post("mappings") createMapping(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateItemMappingDto,
  ) {
    return this.imports.createItemMapping(r.customerIdentity, k, b);
  }
}
