import {
  Body,
  Controller,
  Get,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import { MapPlacesQuery, PinLocationDto } from "./map.dto.js";
import { MapService } from "./map.service.js";

@Controller("map")
@UseGuards(CustomerIdentityGuard)
export class MapController {
  constructor(private readonly service: MapService) {}

  @Get("places") places(@Req() r: CustomerRequest, @Query() q: MapPlacesQuery) {
    return this.service.places(r.customerIdentity, q);
  }

  @Put("locations") pin(@Req() r: CustomerRequest, @Body() b: PinLocationDto) {
    return this.service.pin(r.customerIdentity, b);
  }
}
