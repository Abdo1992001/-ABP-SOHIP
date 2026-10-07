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
import { ApiProblem } from "../platform/api-exception.filter.js";
import {
  ArchiveSegmentDto,
  AsOfQuery,
  AssignSegmentDto,
  ClientBindingDto,
  CommercialStateDto,
  CrPageQuery,
  CreateSegmentDto,
  CreateShipmentDto,
  DeliverShipmentDto,
  DeliveryCalendarQuery,
  DispatchShipmentDto,
  PortalComplaintDto,
  ProvisionClientIdentityDto,
  ShipmentCorrectionDto,
  ShipmentMilestoneDto,
  ShipmentPodDto,
} from "./cr001.dto.js";
import { Cr001Service } from "./cr001.service.js";
import {
  ExternalClientGuard,
  type ExternalPortalRequest,
} from "./external-client.guard.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class Cr001Controller {
  constructor(private readonly service: Cr001Service) {}
  @Get("customer-segments") segments(
    @Req() r: CustomerRequest,
    @Query() q: CrPageQuery,
  ) {
    return this.service.segments(r.customerIdentity, q);
  }
  @Post("customer-segments") async createSegment(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() b: CreateSegmentDto,
  ) {
    const out = await this.service.createSegment(r.customerIdentity, b);
    res.status(201).setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post("customer-segments/:segmentId/archive")
  @HttpCode(200)
  async archiveSegment(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("segmentId", new ParseUUIDPipe()) id: string,
    @Body() b: ArchiveSegmentDto,
  ) {
    const out = await this.service.archiveSegment(r.customerIdentity, id, b);
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Get("accounts/:accountId/segment-assignments") accountSegments(
    @Req() r: CustomerRequest,
    @Param("accountId", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.accountSegments(r.customerIdentity, id);
  }
  @Post("accounts/:accountId/segment-assignments") @HttpCode(200) assignSegment(
    @Req() r: CustomerRequest,
    @Param("accountId", new ParseUUIDPipe()) id: string,
    @Body() b: AssignSegmentDto,
  ) {
    return this.service.assignSegment(r.customerIdentity, id, b);
  }
  @Post("quotations/:quotationId/commercial-state-transitions")
  @HttpCode(200)
  async commercial(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Body() b: CommercialStateDto,
  ) {
    const out = await this.service.transitionCommercial(
      r.customerIdentity,
      id,
      b,
    );
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Get("shipments") shipments(
    @Req() r: CustomerRequest,
    @Query() q: CrPageQuery,
  ) {
    return this.service.shipments(r.customerIdentity, q);
  }
  @Post("shipments") async createShipment(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") key: string | undefined,
    @Body() b: CreateShipmentDto,
  ) {
    const out = await this.service.createShipment(
      r.customerIdentity,
      key ?? "",
      b,
    );
    res.status(201).setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Get("logistics/delivery-calendar") deliveryCalendar(
    @Req() r: CustomerRequest,
    @Query() q: DeliveryCalendarQuery,
  ) {
    return this.service.deliveryCalendar(r.customerIdentity, q);
  }
  @Get("shipments/:shipmentId") async shipment(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("shipmentId", new ParseUUIDPipe()) id: string,
  ) {
    const out = await this.service.shipment(r.customerIdentity, id);
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post("shipments/:shipmentId/milestones") @HttpCode(200) async milestone(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("shipmentId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() b: ShipmentMilestoneDto,
  ) {
    const out = await this.service.advanceShipment(
      r.customerIdentity,
      id,
      key ?? "",
      b,
    );
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post("shipments/:shipmentId/corrections") @HttpCode(200) async correction(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("shipmentId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() b: ShipmentCorrectionDto,
  ) {
    const out = await this.service.correctShipment(
      r.customerIdentity,
      id,
      key ?? "",
      b,
    );
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post("shipments/:shipmentId/dispatch") @HttpCode(200) async dispatchShipment(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("shipmentId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() b: DispatchShipmentDto,
  ) {
    const out = await this.service.dispatchShipment(
      r.customerIdentity,
      id,
      key ?? "",
      b,
    );
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post("shipments/:shipmentId/deliver") @HttpCode(200) async deliverShipment(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("shipmentId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() b: DeliverShipmentDto,
  ) {
    const out = await this.service.deliverShipment(
      r.customerIdentity,
      id,
      key ?? "",
      b,
    );
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post("shipments/:shipmentId/pod") @HttpCode(200) async shipmentPod(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("shipmentId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() b: ShipmentPodDto,
  ) {
    const out = await this.service.shipmentPod(
      r.customerIdentity,
      id,
      key ?? "",
      b,
    );
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Get("admin/client-identities") async listClientIdentities(
    @Req() r: CustomerRequest,
    @Query() q: CrPageQuery,
  ) {
    return this.service.listClientIdentities(r.customerIdentity, q);
  }
  @Post("admin/client-identities") async provision(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() b: ProvisionClientIdentityDto,
  ) {
    const out = await this.service.provision(r.customerIdentity, b);
    res.status(201).setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post("admin/client-identities/:clientId/customer-bindings") async bind(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("clientId", new ParseUUIDPipe()) id: string,
    @Body() b: ClientBindingDto,
  ) {
    const out = await this.service.bind(r.customerIdentity, id, b);
    res.status(201).setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post("admin/client-customer-bindings/:bindingId/revoke")
  @HttpCode(200)
  async revoke(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("bindingId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") etag: string | undefined,
  ) {
    const out = await this.service.revokeBinding(
      r.customerIdentity,
      id,
      parseTag(etag),
    );
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Get("research/most-requested-sizes") research(
    @Req() r: CustomerRequest,
    @Query() q: AsOfQuery,
  ) {
    return this.service.researchSizes(r.customerIdentity, q);
  }
}

@Controller("portal")
@UseGuards(ExternalClientGuard)
export class ClientPortalController {
  constructor(private readonly service: Cr001Service) {}
  @Get("customer-contexts") contexts(@Req() r: ExternalPortalRequest) {
    return this.service.portalContext(r.externalPortalIdentity);
  }
  @Get("customers/:accountId/orders") orders(
    @Req() r: ExternalPortalRequest,
    @Param("accountId", new ParseUUIDPipe()) id: string,
    @Query() q: CrPageQuery,
  ) {
    return this.service.portalOrders(r.externalPortalIdentity, id, q);
  }
  @Get("customers/:accountId/shipments") shipments(
    @Req() r: ExternalPortalRequest,
    @Param("accountId", new ParseUUIDPipe()) id: string,
    @Query() q: CrPageQuery,
  ) {
    return this.service.portalShipments(r.externalPortalIdentity, id, q);
  }
  @Get("customers/:accountId/complaints") complaints(
    @Req() r: ExternalPortalRequest,
    @Param("accountId", new ParseUUIDPipe()) id: string,
    @Query() q: CrPageQuery,
  ) {
    return this.service.portalComplaints(r.externalPortalIdentity, id, q);
  }
  @Post("customers/:accountId/complaints") createComplaint(
    @Req() r: ExternalPortalRequest,
    @Param("accountId", new ParseUUIDPipe()) id: string,
    @Body() b: PortalComplaintDto,
  ) {
    return this.service.createPortalComplaint(r.externalPortalIdentity, id, b);
  }
}

function parseTag(value: string | undefined) {
  const match = /^(?:W\/)?"?rv-(\d+)"?$/.exec(value?.trim() ?? "");
  if (!match) throw new ApiProblem({ status: 428, code: "IF_MATCH_REQUIRED" });
  const rowVersion = match[1];
  if (!rowVersion)
    throw new ApiProblem({ status: 428, code: "IF_MATCH_REQUIRED" });
  return BigInt(rowVersion);
}
