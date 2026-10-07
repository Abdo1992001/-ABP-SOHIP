import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { components } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import {
  type DatabaseClient,
  Prisma,
  TransactionManager,
  type TransactionClient,
} from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import { CustomerAccessService } from "../customer/customer-access.service.js";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import type {
  ProductImageUploadDto,
  ProductListQuery,
  UpdateProductDto,
} from "./product.dto.js";

type Product = components["schemas"]["Product"];
type Row = Prisma.ProductGetPayload<{ include: { productFamily: true } }>;
type ProductWithVersion = Product & { rowVersion: string };
const include = { productFamily: true } satisfies Prisma.ProductInclude;

@Injectable()
export class ProductService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly access: CustomerAccessService,
  ) {}
  async list(identity: CustomerIdentity, query: ProductListQuery) {
    this.access.requirePermission(identity, permissions.catalogView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = {
      recordStatusCode: "ACTIVE",
      ...(search
        ? {
            OR: [
              { skuCode: { contains: search, mode: "insensitive" } },
              { barcode: { contains: search, mode: "insensitive" } },
              {
                normalizedDescription: {
                  contains: normalize(search),
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.product.count({ where }),
      this.db.product.findMany({
        where,
        include,
        skip: offset,
        take: query.limit,
        orderBy: query.sort.startsWith("skuCode")
          ? { skuCode: query.sort.endsWith("desc") ? "desc" : "asc" }
          : {
              canonicalDescription: query.sort.endsWith("desc")
                ? "desc"
                : "asc",
            },
      }),
    ]);
    return {
      data: rows.map(toProduct),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }
  async get(
    identity: CustomerIdentity,
    id: string,
  ): Promise<ProductWithVersion> {
    this.access.requirePermission(identity, permissions.catalogView);
    const row = await this.db.product.findFirst({
      where: { id, recordStatusCode: "ACTIVE" },
      include,
    });
    if (!row) notFound();
    return { ...toProduct(row), rowVersion: row.rowVersion.toString() };
  }
  async update(
    identity: CustomerIdentity,
    id: string,
    tag: string,
    input: UpdateProductDto,
  ): Promise<ProductWithVersion> {
    this.access.requirePermission(identity, permissions.catalogManage);
    const version = parse(tag);
    const before = await this.db.product.findFirst({
      where: { id, recordStatusCode: "ACTIVE" },
      include,
    });
    if (!before) notFound();
    if (before.rowVersion !== version)
      throw new ApiProblem({ status: 412, code: "PRECONDITION_FAILED" });
    const canonicalDescription =
      input.canonicalDescription === undefined
        ? undefined
        : input.canonicalDescription?.trim() || before.canonicalDescription;
    const data: Prisma.ProductUncheckedUpdateManyInput = {
      ...(input.skuCode === undefined
        ? {}
        : {
            skuCode:
              input.skuCode === null ? null : input.skuCode.trim() || null,
          }),
      ...(input.barcode === undefined
        ? {}
        : {
            barcode:
              input.barcode === null ? null : input.barcode.trim() || null,
          }),
      ...(canonicalDescription === undefined
        ? {}
        : {
            canonicalDescription,
            normalizedDescription: normalize(canonicalDescription),
          }),
      ...(input.thicknessMm === undefined
        ? {}
        : {
            thicknessMm:
              input.thicknessMm === null
                ? null
                : new Prisma.Decimal(input.thicknessMm),
          }),
      ...(input.widthMm === undefined
        ? {}
        : {
            widthMm:
              input.widthMm === null ? null : new Prisma.Decimal(input.widthMm),
          }),
      ...(input.lengthMm === undefined
        ? {}
        : {
            lengthMm:
              input.lengthMm === null
                ? null
                : new Prisma.Decimal(input.lengthMm),
          }),
      ...(input.weightKg === undefined
        ? {}
        : {
            weightKg:
              input.weightKg === null
                ? null
                : new Prisma.Decimal(input.weightKg),
          }),
      ...(input.densityKgM3 === undefined
        ? {}
        : {
            densityKgM3:
              input.densityKgM3 === null
                ? null
                : new Prisma.Decimal(input.densityKgM3),
          }),
      ...(input.statusCode == null
        ? {}
        : { recordStatusCode: input.statusCode }),
      updatedByUserId: identity.userId,
      rowVersion: { increment: 1 },
    };
    await this.txs.run(identity, async (tx: TransactionClient) => {
      const result = await tx.product.updateMany({
        where: { id, rowVersion: version, recordStatusCode: "ACTIVE" },
        data,
      });
      if (result.count !== 1)
        throw new ApiProblem({ status: 412, code: "PRECONDITION_FAILED" });
    });
    const updated = await this.db.product.findUnique({
      where: { id },
      include,
    });
    if (!updated) notFound();
    return { ...toProduct(updated), rowVersion: updated.rowVersion.toString() };
  }
  /**
   * Replace a product's photo.
   *
   * Uploading a new photo does not rewrite documents already sent: a quotation
   * line records the image id it used, and this creates a new row rather than
   * overwriting the old one. The previous primary is demoted, not deleted.
   */
  async uploadImage(
    identity: CustomerIdentity,
    productId: string,
    input: ProductImageUploadDto,
  ) {
    this.access.requirePermission(identity, permissions.catalogManage);
    const product = await this.db.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product)
      throw new ApiProblem({ status: 404, code: "PRODUCT_NOT_FOUND" });

    const bytes = Buffer.from(input.contentBase64, "base64");
    if (bytes.length < 1 || bytes.length > 10 * 1024 * 1024)
      throw new ApiProblem({ status: 422, code: "IMAGE_SIZE_INVALID" });
    if (!looksLikeImage(bytes, input.contentType))
      throw new ApiProblem({ status: 422, code: "IMAGE_CONTENT_INVALID" });

    const id = randomUUID();
    const storageKey = `${id}.bin`;
    const directory = join(objectRoot(), "product-images");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, storageKey), bytes, {
      flag: "wx",
      mode: 0o640,
    });

    const image = await this.db.$transaction(async (tx) => {
      await tx.productImage.updateMany({
        where: { productId, isPrimary: true },
        data: { isPrimary: false },
      });
      return tx.productImage.create({
        data: {
          id,
          productId,
          storageKey,
          fileName: basename(input.fileName),
          contentType: input.contentType,
          sizeBytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          isPrimary: true,
          uploadedByUserId: identity.userId,
        },
      });
    });
    return { data: imageDto(image) };
  }

  async listImages(identity: CustomerIdentity, productId: string) {
    this.access.requirePermission(identity, permissions.catalogView);
    const rows = await this.db.productImage.findMany({
      where: { productId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
    });
    return { data: rows.map(imageDto) };
  }

  /** Serves the bytes. Any authenticated user who may see products may see them. */
  async readImage(identity: CustomerIdentity, imageId: string) {
    this.access.requirePermission(identity, permissions.catalogView);
    const image = await this.db.productImage.findUnique({
      where: { id: imageId },
    });
    if (!image) throw new ApiProblem({ status: 404, code: "IMAGE_NOT_FOUND" });
    return {
      image,
      bytes: await readFile(
        join(objectRoot(), "product-images", image.storageKey),
      ),
    };
  }

  async deleteImage(identity: CustomerIdentity, imageId: string) {
    this.access.requirePermission(identity, permissions.catalogManage);
    const image = await this.db.productImage.findUnique({
      where: { id: imageId },
    });
    if (!image) throw new ApiProblem({ status: 404, code: "IMAGE_NOT_FOUND" });
    // The file on disk is kept: a quotation line may still reference this image
    // as the one it was issued with, and deleting the bytes would blank a
    // document that has already gone to a customer.
    await this.db.productImage.delete({ where: { id: imageId } });
    return { data: { success: true, resourceId: imageId } };
  }
}
function toProduct(row: Row): Product {
  return {
    productId: row.id,
    skuCode: row.skuCode,
    barcode: row.barcode,
    productFamilyId: row.productFamilyId,
    productTypeCode: row.productTypeCode,
    canonicalDescription: row.canonicalDescription,
    thicknessMm: dec(row.thicknessMm),
    widthMm: dec(row.widthMm),
    lengthMm: dec(row.lengthMm),
    weightKg: dec(row.weightKg),
    densityKgM3: dec(row.densityKgM3),
    statusCode: row.recordStatusCode,
  };
}
function dec(value: Prisma.Decimal | null) {
  return value?.toString() ?? null;
}
function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}
function parse(value: string) {
  if (!/^\d+$/.test(value))
    throw new ApiProblem({ status: 428, code: "IF_MATCH_REQUIRED" });
  return BigInt(value);
}
function notFound(): never {
  throw new ApiProblem({ status: 404, code: "PRODUCT_NOT_FOUND" });
}

function imageDto(row: {
  id: string;
  productId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isPrimary: boolean;
  createdAt: Date;
}) {
  return {
    productImageId: row.id,
    productId: row.productId,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt.toISOString(),
    url: `/api/v1/product-images/${row.id}/content`,
  };
}

/**
 * Checks the file's magic bytes against the declared type.
 *
 * A client can claim any content type it likes; serving an arbitrary upload back
 * with an image content type is how a stored-XSS gets into a CRM. The signature
 * has to agree with the claim.
 */
function looksLikeImage(bytes: Buffer, contentType: string) {
  if (bytes.length < 12) return false;
  const png = bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG";
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const gif = bytes.toString("ascii", 0, 3) === "GIF";
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  switch (contentType) {
    case "image/png":
      return png;
    case "image/jpeg":
      return jpeg;
    case "image/gif":
      return gif;
    case "image/webp":
      return webp;
    default:
      return false;
  }
}

function objectRoot() {
  return process.env.ABP_LOCAL_OBJECT_ROOT ?? join(process.cwd(), "storage");
}
