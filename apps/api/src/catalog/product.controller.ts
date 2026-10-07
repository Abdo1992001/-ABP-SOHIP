import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ProductService } from "./product.service.js";
import {
  ProductImageUploadDto,
  ProductListQuery,
  UpdateProductDto,
} from "./product.dto.js";

@Controller("products")
@UseGuards(CustomerIdentityGuard)
export class ProductController {
  constructor(private readonly products: ProductService) {}
  @Get() list(
    @Req() request: CustomerRequest,
    @Query() query: ProductListQuery,
  ) {
    return this.products.list(request.customerIdentity, query);
  }
  @Get("search") search(
    @Req() request: CustomerRequest,
    @Query() query: ProductListQuery,
  ) {
    return this.products.list(request.customerIdentity, query);
  }
  @Get(":productId") async get(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("productId", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.products.get(request.customerIdentity, id);
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Patch(":productId") async update(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("productId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") tag: string | undefined,
    @Body() input: UpdateProductDto,
  ) {
    const data = await this.products.update(
      request.customerIdentity,
      id,
      tag ?? "",
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Get(":productId/images")
  images(
    @Req() request: CustomerRequest,
    @Param("productId", new ParseUUIDPipe()) productId: string,
  ) {
    return this.products.listImages(request.customerIdentity, productId);
  }

  @Post(":productId/images")
  @HttpCode(201)
  uploadImage(
    @Req() request: CustomerRequest,
    @Param("productId", new ParseUUIDPipe()) productId: string,
    @Body() input: ProductImageUploadDto,
  ) {
    return this.products.uploadImage(
      request.customerIdentity,
      productId,
      input,
    );
  }
}

/**
 * Image bytes live on their own path rather than under /products/:id, because a
 * quotation line references an image by id and must be able to render it
 * without first knowing which product it belonged to.
 */
@Controller("product-images")
@UseGuards(CustomerIdentityGuard)
export class ProductImageController {
  constructor(private readonly products: ProductService) {}

  // Not passthrough: returning the Buffer would let Nest serialize it as JSON,
  // which turns a 73-byte PNG into a 235-byte array of numbers that no browser
  // can render. The bytes are written to the response directly.
  @Get(":imageId/content")
  async content(
    @Req() request: CustomerRequest,
    @Param("imageId", new ParseUUIDPipe()) imageId: string,
    @Res() response: Response,
  ) {
    const { image, bytes } = await this.products.readImage(
      request.customerIdentity,
      imageId,
    );
    response.setHeader("Content-Type", image.contentType);
    response.setHeader("Content-Length", String(bytes.length));
    // Immutable: a new upload gets a new id, so this body never changes.
    response.setHeader("Cache-Control", "private, max-age=86400, immutable");
    response.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`,
    );
    response.send(bytes);
  }

  @Delete(":imageId")
  @HttpCode(200)
  remove(
    @Req() request: CustomerRequest,
    @Param("imageId", new ParseUUIDPipe()) imageId: string,
  ) {
    return this.products.deleteImage(request.customerIdentity, imageId);
  }
}
