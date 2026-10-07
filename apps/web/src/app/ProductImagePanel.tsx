import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, components } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { ErrorBanner } from "./CommercialUI.tsx";

type ProductImage = components["schemas"]["ProductImage"];
type ImageContentType =
  components["schemas"]["ProductImageUploadRequest"]["contentType"];

/**
 * The product's photo.
 *
 * It is uploaded once, against the product, and every quotation that sells the
 * product renders it from here. Uploading a replacement does not rewrite
 * documents already issued: the new photo becomes the primary one and the old
 * row stays, because a quotation line records which image it went out with.
 */
export function ProductImagePanel({
  client,
  productId,
  canManage,
}: {
  client: ApiClient;
  productId: string;
  canManage: boolean;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const labels = ar ? arLabels : enLabels;
  const cache = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const images = useQuery<ProductImage[]>({
    queryKey: ["product-images", productId],
    queryFn: async () => {
      const result = await client.GET("/products/{productId}/images", {
        params: { path: { productId } },
      });
      if (!result.data)
        throw new Error(`PRODUCT_IMAGES_${String(result.response.status)}`);
      return result.data.data as unknown as ProductImage[];
    },
  });

  const upload = useMutation({
    mutationFn: async (file: {
      handle: File;
      contentType: ImageContentType;
    }) => {
      const result = await client.POST("/products/{productId}/images", {
        params: { path: { productId } },
        body: {
          fileName: file.handle.name,
          contentType: file.contentType,
          contentBase64: await toBase64(file.handle),
        },
      });
      if (!result.data)
        throw new Error(`UPLOAD_${String(result.response.status)}`);
      return result.data;
    },
    onSuccess: () => {
      setLocalError(null);
      if (fileInput.current) fileInput.current.value = "";
      void cache.invalidateQueries({ queryKey: ["product-images", productId] });
    },
  });

  const primary = (images.data ?? []).find((image) => image.isPrimary);
  const alternates = (images.data ?? []).filter((image) => !image.isPrimary);

  const choose = (file: File | undefined) => {
    if (!file) return;
    // Checked here as well as on the server: rejecting a 12 MB photo after the
    // upload has already been base64-encoded and sent is a poor apology.
    if (file.size > 10 * 1024 * 1024) {
      setLocalError(labels.tooLarge);
      return;
    }
    // Narrowed rather than cast: the contract only accepts these four types,
    // and a browser will happily report anything as a file's type.
    const contentType = accepted.find((type) => type === file.type);
    if (contentType === undefined) {
      setLocalError(labels.wrongType);
      return;
    }
    setLocalError(null);
    upload.mutate({ handle: file, contentType });
  };

  return (
    <section className="product-image-panel">
      <h3>{labels.title}</h3>
      <p className="product-image-hint">{labels.hint}</p>

      <ErrorBanner
        error={images.error}
        retry={() => {
          void images.refetch();
        }}
      />
      <ErrorBanner error={upload.error} retry={() => undefined} />
      {localError !== null && (
        <p className="product-image-error">{localError}</p>
      )}

      <div className="product-image-stage">
        {primary ? (
          <img src={primary.url} alt={primary.fileName} loading="lazy" />
        ) : (
          <div className="product-image-empty">{labels.noImage}</div>
        )}
      </div>

      {canManage && (
        <label className="product-image-upload">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={upload.isPending}
            onChange={(event) => {
              choose(event.target.files?.[0]);
            }}
          />
          <span>{upload.isPending ? labels.uploading : labels.upload}</span>
        </label>
      )}

      {alternates.length > 0 && (
        <>
          <h4 className="product-image-previous">{labels.previous}</h4>
          <div className="product-image-thumbs">
            {alternates.map((image) => (
              <img
                key={image.productImageId}
                src={image.url}
                alt={image.fileName}
                title={`${image.fileName} · ${labels.keptForIssued}`}
                loading="lazy"
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const accepted: ImageContentType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // Chunked: spreading a multi-megabyte array into String.fromCharCode at once
  // overflows the call stack.
  const chunk = 8192;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

const enLabels = {
  title: "Product photo",
  hint: "Used on every quotation that sells this product.",
  noImage: "No photo yet",
  upload: "Upload a photo",
  uploading: "Uploading…",
  previous: "Previous photos",
  keptForIssued: "kept for quotations already issued with it",
  tooLarge: "That file is over 10 MB. Use a smaller image.",
  wrongType: "Use a PNG, JPEG, WebP or GIF image.",
};

const arLabels: typeof enLabels = {
  title: "صورة المنتج",
  hint: "تُستخدم في كل عرض سعر يحتوي على هذا المنتج.",
  noImage: "لا توجد صورة بعد",
  upload: "ارفع صورة",
  uploading: "جارٍ الرفع…",
  previous: "الصور السابقة",
  keptForIssued: "محفوظة لعروض الأسعار التي صدرت بها",
  tooLarge: "حجم الملف أكبر من 10 ميجابايت. استخدم صورة أصغر.",
  wrongType: "استخدم صورة PNG أو JPEG أو WebP أو GIF.",
};
