import {
  Body,
  Controller,
  Delete,
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
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import {
  CompleteUploadDto,
  CreateExportDto,
  CreateUploadDto,
  DocumentListQuery,
  LinkDocumentDto,
} from "./documents.dto.js";
import { DocumentsService } from "./documents.service.js";
@Controller()
@UseGuards(CustomerIdentityGuard)
export class DocumentsController {
  constructor(private readonly s: DocumentsService) {}
  @Get("documents") list(
    @Req() r: CustomerRequest,
    @Query() q: DocumentListQuery,
  ) {
    return this.s.list(r.customerIdentity, q);
  }
  @Post("documents/uploads")
  @HttpCode(200)
  upload(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateUploadDto,
  ) {
    return this.s.upload(r.customerIdentity, k ?? "", b);
  }
  @Get("documents/uploads/:uploadSessionId") uploadStatus(
    @Req() r: CustomerRequest,
    @Param("uploadSessionId", new ParseUUIDPipe()) id: string,
  ) {
    return this.s.uploadStatus(r.customerIdentity, id);
  }
  @Post("documents/uploads/:uploadSessionId/content")
  @HttpCode(200)
  uploadContent(
    @Req() r: CustomerRequest,
    @Param("uploadSessionId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Body() body: Buffer,
  ) {
    return this.s.writeContent(r.customerIdentity, id, k ?? "", body);
  }
  @Post("documents/uploads/:uploadSessionId/complete") async complete(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("uploadSessionId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CompleteUploadDto,
  ) {
    const o = await this.s.complete(r.customerIdentity, id, k ?? "", b);
    res.status(o.status === 202 ? 202 : 200);
    return { data: o.data };
  }
  @Get("documents/:documentId") document(
    @Req() r: CustomerRequest,
    @Param("documentId", new ParseUUIDPipe()) id: string,
  ) {
    return this.s.document(r.customerIdentity, id);
  }
  @Get("documents/:documentId/versions") versions(
    @Req() r: CustomerRequest,
    @Param("documentId", new ParseUUIDPipe()) id: string,
  ) {
    return this.s.versions(r.customerIdentity, id);
  }
  @Get("documents/:documentId/download") download(
    @Req() r: CustomerRequest,
    @Param("documentId", new ParseUUIDPipe()) id: string,
  ) {
    return this.s.download(r.customerIdentity, id);
  }
  @Get("documents/:documentId/content") async content(
    @Req() r: CustomerRequest,
    @Param("documentId", new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.s.content(r.customerIdentity, id);
    res.setHeader("Cache-Control", "private, no-store");
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }
  @Post("documents/:documentId/links")
  @HttpCode(200)
  link(
    @Req() r: CustomerRequest,
    @Param("documentId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: LinkDocumentDto,
  ) {
    return this.s.link(r.customerIdentity, id, k ?? "", b);
  }
  @Delete("document-links/:linkId") async unlink(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("linkId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") t: string | undefined,
    @Headers("idempotency-key") k: string | undefined,
  ) {
    const o = await this.s.unlink(r.customerIdentity, id, t ?? "", k ?? "");
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Post("exports") async createExport(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateExportDto,
  ) {
    const o = await this.s.createExport(r.customerIdentity, k ?? "", b);
    res.status(202);
    return { data: o };
  }
  @Get("exports/:exportId") exportStatus(
    @Req() r: CustomerRequest,
    @Param("exportId", new ParseUUIDPipe()) id: string,
  ) {
    return this.s.exportStatus(r.customerIdentity, id);
  }
}
