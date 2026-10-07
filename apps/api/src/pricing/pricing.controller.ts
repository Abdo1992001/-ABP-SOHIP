import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
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
  CreateDocumentSubjectDto,
  CreateGuardrailDto,
  CreateTaxPolicyDto,
  CalculationFormulaListQuery,
  CreateCalculationFormulaDto,
  PolicyListQuery,
  PriceOverrideDto,
  PricingResolveDto,
  UpdateCompanyPricingSettingsDto,
} from "./pricing.dto.js";
import { PricingService } from "./pricing.service.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}
  @Get("payment-terms") paymentTerms(
    @Req() r: CustomerRequest,
    @Query() q: PolicyListQuery,
  ) {
    return this.pricing.paymentTerms(r.customerIdentity, q);
  }
  // The subject line a document carries. It lives beside `payment-terms`
  // and the company document defaults because it is the same kind of thing:
  // one company-wide list every offer reads from.
  @Get("document-subjects") documentSubjects(
    @Req() r: CustomerRequest,
    @Query() q: PolicyListQuery,
  ) {
    return this.pricing.documentSubjects(r.customerIdentity, q);
  }
  @Post("document-subjects") createDocumentSubject(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: CreateDocumentSubjectDto,
  ) {
    return this.pricing.createDocumentSubject(r.customerIdentity, key, dto);
  }
  @Post("pricing/guardrails") guardrail(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: CreateGuardrailDto,
  ) {
    return this.pricing.createGuardrail(r.customerIdentity, key, dto);
  }
  @Post("pricing/manager-overrides") override(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: PriceOverrideDto,
  ) {
    return this.pricing.requestOverride(r.customerIdentity, key, dto);
  }
  @Post("pricing/resolve")
  @HttpCode(200)
  resolve(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: PricingResolveDto,
  ) {
    return this.pricing.resolve(r.customerIdentity, key, dto);
  }
  @Get("pricing/standard-board-basis") basis(@Req() r: CustomerRequest) {
    return this.pricing.basis(r.customerIdentity);
  }
  @Post("pricing/standard-board-basis") updateBasis(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: UpdateCompanyPricingSettingsDto,
  ) {
    return this.pricing.updateBasis(r.customerIdentity, key, dto);
  }
  @Get("pricing/calculation-formulas") calculationFormulas(
    @Req() r: CustomerRequest,
    @Query() q: CalculationFormulaListQuery,
  ) {
    return this.pricing.calculationFormulas(r.customerIdentity, q);
  }
  @Post("pricing/calculation-formulas") createCalculationFormula(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: CreateCalculationFormulaDto,
  ) {
    return this.pricing.createCalculationFormula(r.customerIdentity, key, dto);
  }
  @Post("pricing/calculation-formulas/:formulaKey/retire")
  @HttpCode(200)
  retireCalculationFormula(
    @Req() r: CustomerRequest,
    @Param("formulaKey") formulaKey: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.pricing.retireCalculationFormula(
      r.customerIdentity,
      formulaKey,
      key,
    );
  }
  @Get("tax-policies") taxes(
    @Req() r: CustomerRequest,
    @Query() q: PolicyListQuery,
  ) {
    return this.pricing.taxPolicies(r.customerIdentity, q);
  }
  @Post("tax-policies") tax(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: CreateTaxPolicyDto,
  ) {
    return this.pricing.createTaxPolicy(r.customerIdentity, key, dto);
  }
}
