import type { ApiClient, components, operations } from "@abp/api-client";
import { CustomerApiError } from "./customer-api.ts";

export type Product = components["schemas"]["Product"];
export type ProductListQuery = NonNullable<
  operations["get_products"]["parameters"]["query"]
>;
export type ProductUpdate = NonNullable<
  operations["patch_products_by_productId"]["requestBody"]
>["content"]["application/json"];

export async function listProducts(
  client: ApiClient,
  query: ProductListQuery,
): Promise<components["schemas"]["ProductListEnvelope"]> {
  const result = await client.GET("/products", { params: { query } });
  if (result.data !== undefined)
    return result.data as unknown as components["schemas"]["ProductListEnvelope"];
  throw new CustomerApiError(
    result.response.status,
    result.error as unknown as
      components["schemas"]["ErrorEnvelope"] | undefined,
  );
}

export async function getProduct(client: ApiClient, productId: string) {
  const result = await client.GET("/products/{productId}", {
    params: { path: { productId } },
  });
  if (result.data !== undefined)
    return { data: result.data.data, response: result.response };
  throw new CustomerApiError(
    result.response.status,
    result.error as unknown as
      components["schemas"]["ErrorEnvelope"] | undefined,
  );
}

export async function updateProduct(
  client: ApiClient,
  productId: string,
  rowVersion: string,
  body: ProductUpdate,
) {
  const result = await client.PATCH("/products/{productId}", {
    params: {
      path: { productId },
      header: { "If-Match": rowVersion },
    },
    body,
  });
  if (result.data !== undefined) return result.data;
  throw new CustomerApiError(
    result.response.status,
    result.error as unknown as
      components["schemas"]["ErrorEnvelope"] | undefined,
  );
}
