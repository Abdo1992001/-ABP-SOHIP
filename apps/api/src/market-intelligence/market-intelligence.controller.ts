import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import {
  CreateCompetitorDto,
  CreateMarketSignalDto,
  CreateRepeatBusinessRequestDto,
  CreateTargetAccountDto,
  CreateTargetMarketDto,
  CreateWatchlistEntryDto,
  IntelligenceListQuery,
  UpdateRepeatBusinessRequestDto,
} from "./market-intelligence.dto.js";
import { MarketIntelligenceService } from "./market-intelligence.service.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class MarketIntelligenceController {
  constructor(private readonly service: MarketIntelligenceService) {}

  @Get("market-signals")
  signals(
    @Req() request: CustomerRequest,
    @Query() query: IntelligenceListQuery,
  ) {
    return this.service.listSignals(request.customerIdentity, query);
  }

  @Post("market-signals")
  createSignal(
    @Req() request: CustomerRequest,
    @Body() input: CreateMarketSignalDto,
  ) {
    return this.service.createSignal(request.customerIdentity, input);
  }

  @Get("target-markets")
  targetMarkets(
    @Req() request: CustomerRequest,
    @Query() query: IntelligenceListQuery,
  ) {
    return this.service.listTargetMarkets(request.customerIdentity, query);
  }

  @Post("target-markets")
  createTargetMarket(
    @Req() request: CustomerRequest,
    @Body() input: CreateTargetMarketDto,
  ) {
    return this.service.createTargetMarket(request.customerIdentity, input);
  }

  @Get("target-accounts")
  targetAccounts(
    @Req() request: CustomerRequest,
    @Query() query: IntelligenceListQuery,
  ) {
    return this.service.listTargetAccounts(request.customerIdentity, query);
  }

  @Post("target-accounts")
  createTargetAccount(
    @Req() request: CustomerRequest,
    @Body() input: CreateTargetAccountDto,
  ) {
    return this.service.createTargetAccount(request.customerIdentity, input);
  }

  @Post("target-accounts/:targetAccountId/prepare-customer")
  @HttpCode(200)
  prepareCustomer(
    @Req() request: CustomerRequest,
    @Param("targetAccountId", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.prepareTargetAccount(
      request.customerIdentity,
      id,
      "CUSTOMER",
    );
  }

  @Post("target-accounts/:targetAccountId/prepare-opportunity")
  @HttpCode(200)
  prepareOpportunity(
    @Req() request: CustomerRequest,
    @Param("targetAccountId", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.prepareTargetAccount(
      request.customerIdentity,
      id,
      "OPPORTUNITY",
    );
  }

  @Get("competitors")
  competitors(
    @Req() request: CustomerRequest,
    @Query() query: IntelligenceListQuery,
  ) {
    return this.service.listCompetitors(request.customerIdentity, query);
  }

  @Post("competitors")
  createCompetitor(
    @Req() request: CustomerRequest,
    @Body() input: CreateCompetitorDto,
  ) {
    return this.service.createCompetitor(request.customerIdentity, input);
  }

  @Get("watchlist")
  watchlist(
    @Req() request: CustomerRequest,
    @Query() query: IntelligenceListQuery,
  ) {
    return this.service.listWatchlist(request.customerIdentity, query);
  }

  @Post("watchlist")
  createWatchlist(
    @Req() request: CustomerRequest,
    @Body() input: CreateWatchlistEntryDto,
  ) {
    return this.service.createWatchlist(request.customerIdentity, input);
  }

  @Delete("watchlist/:watchlistEntryId")
  removeWatchlist(
    @Req() request: CustomerRequest,
    @Param("watchlistEntryId", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.removeWatchlist(request.customerIdentity, id);
  }

  @Get("repeat-business-requests")
  repeatBusiness(
    @Req() request: CustomerRequest,
    @Query() query: IntelligenceListQuery,
  ) {
    return this.service.listRepeatBusiness(request.customerIdentity, query);
  }

  @Post("repeat-business-requests")
  createRepeatBusiness(
    @Req() request: CustomerRequest,
    @Body() input: CreateRepeatBusinessRequestDto,
  ) {
    return this.service.createRepeatBusiness(request.customerIdentity, input);
  }

  @Patch("repeat-business-requests/:requestId")
  updateRepeatBusiness(
    @Req() request: CustomerRequest,
    @Param("requestId", new ParseUUIDPipe()) id: string,
    @Body() input: UpdateRepeatBusinessRequestDto,
  ) {
    return this.service.updateRepeatBusiness(
      request.customerIdentity,
      id,
      input,
    );
  }
}
