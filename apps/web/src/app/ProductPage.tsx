import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { ApiClient, components } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import { ErrorBanner, PageHeader, TabBar, useToast } from "./CommercialUI.tsx";
import { ProductImagePanel } from "./ProductImagePanel.tsx";
import { PriceCheckPanel } from "./PriceCheckPanel.tsx";
import { useI18n } from "../i18n/i18n.tsx";
import {
  getProduct,
  listProducts,
  updateProduct,
  type ProductUpdate,
} from "../api/product-api.ts";
import type { Me } from "../api/customer-api.ts";
import { listAccounts } from "../api/customer-api.ts";
import { listProjects } from "../api/project-api.ts";
import { listOpportunities } from "../api/opportunity-api.ts";

export function ProductPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState("overview");
  const { productId } = useParams();
  const [search, setSearch] = useState("");
  const products = useQuery({
    queryKey: ["products", search, page],
    queryFn: () =>
      listProducts(client, {
        ...(search.trim() === "" ? {} : { search: search.trim() }),
        page,
        limit: 25,
        sort: "canonicalDescription:asc",
      }),
  });
  const detail = useQuery({
    queryKey: ["product", productId],
    queryFn: () => getProduct(client, productId ?? ""),
    enabled: productId !== undefined,
  });

  return (
    <section className="customer-page">
      <PageHeader
        screenId="PRODUCTS"
        kicker={txt("Catalog", "الكتالوج")}
        title={txt("Products", "المنتجات")}
        sub={txt(
          "Search products, specifications, and SKU codes.",
          "ابحث عن المنتجات والمواصفات وأكواد الأصناف.",
        )}
        {...(typeof products.data?.meta.total === "number"
          ? { count: products.data.meta.total }
          : {})}
      />
      <div className="customer-layout">
        <section className="panel customer-list-panel">
          <input
            aria-label={txt("Search products", "ابحث في المنتجات")}
            placeholder={txt(
              "SKU, barcode, or description",
              "كود الصنف أو الباركود أو الوصف",
            )}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          {products.isLoading && (
            <div
              className="skeleton-stack"
              aria-label={txt("Loading products", "جار تحميل المنتجات")}
              role="status"
            >
              <span />
              <span />
              <span />
            </div>
          )}
          {products.isError && (
            <ErrorBanner
              error={products.error}
              retry={() => void products.refetch()}
            />
          )}
          {products.data?.data.length === 0 && (
            <p className="today-empty">
              {txt(
                "Nothing matches that search.",
                "مفيش حاجة مطابقة للبحث ده.",
              )}
            </p>
          )}
          <div className="customer-list">
            {(products.data?.data ?? []).map((product) => (
              <Link
                className="list-link"
                key={product.productId}
                to={`/products/${product.productId}`}
              >
                {product.skuCode ?? txt("No SKU", "بدون كود")} ·{" "}
                {product.canonicalDescription}
              </Link>
            ))}
          </div>
          <footer className="pagination">
            <button
              disabled={page === 1}
              onClick={() => {
                setPage(page - 1);
              }}
            >
              {txt("Previous", "السابق")}
            </button>
            <span>{page}</span>
            <button
              disabled={!products.data?.meta.hasNext}
              onClick={() => {
                setPage(page + 1);
              }}
            >
              {txt("Next", "التالي")}
            </button>
          </footer>
        </section>
        {/* With nothing picked, this column used to be left out entirely and
            the page ran as a narrow strip against a wide empty half. It now
            says what the column is for. */}
        {productId === undefined && (
          <section className="panel detail-panel">
            <p className="today-empty">
              {txt(
                "Pick a product to see its specification, dimensions and the price it computes to.",
                "اختار منتج عشان تشوف مواصفاته ومقاساته والسعر اللي بيطلع منه.",
              )}
            </p>
          </section>
        )}
        {productId !== undefined && (
          <section className="panel detail-panel">
            {detail.isLoading && (
              <div
                className="skeleton-stack"
                aria-label={txt("Loading product", "جار تحميل المنتج")}
                role="status"
              >
                <span />
                <span />
                <span />
              </div>
            )}
            {detail.isError && (
              <ErrorBanner
                error={detail.error}
                retry={() => void detail.refetch()}
              />
            )}
            {detail.data && (
              <>
                <h2>{detail.data.data.canonicalDescription}</h2>
                <TabBar
                  tabs={[
                    { id: "overview", en: "Specifications", ar: "المواصفات" },
                    ...(me.access.permissions.includes(permissions.pricingView)
                      ? [{ id: "price", en: "Price check", ar: "فحص السعر" }]
                      : []),
                    ...(me.access.permissions.includes(
                      permissions.catalogManage,
                    )
                      ? [{ id: "edit", en: "Edit product", ar: "تعديل المنتج" }]
                      : []),
                  ]}
                  active={tab}
                  onChange={setTab}
                />
                {tab === "overview" && (
                  <>
                    <ProductImagePanel
                      client={client}
                      productId={detail.data.data.productId}
                      canManage={me.access.permissions.includes(
                        permissions.catalogManage,
                      )}
                    />
                    {/* Units are part of the label, not left for the reader
                        to assume: a board quoted in the wrong unit is a board
                        quoted at the wrong price. */}
                    <dl className="product-spec-list">
                      <div>
                        <dt>{txt("SKU", "كود الصنف")}</dt>
                        <dd data-abp-num>{detail.data.data.skuCode ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>{txt("Barcode", "الباركود")}</dt>
                        <dd data-abp-num>{detail.data.data.barcode ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>
                          {txt(
                            "Dimensions (thickness × width × length, mm)",
                            "المقاسات (السمك × العرض × الطول، مم)",
                          )}
                        </dt>
                        <dd data-abp-num>
                          {[
                            detail.data.data.thicknessMm,
                            detail.data.data.widthMm,
                            detail.data.data.lengthMm,
                          ]
                            .filter(Boolean)
                            .join(" × ") || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>{txt("Weight (kg)", "الوزن (كجم)")}</dt>
                        <dd data-abp-num>{detail.data.data.weightKg ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>{txt("Density (kg/m³)", "الكثافة (كجم/م³)")}</dt>
                        <dd data-abp-num>
                          {detail.data.data.densityKgM3 ?? "—"}
                        </dd>
                      </div>
                    </dl>
                    <EngineeringStudio
                      client={client}
                      product={detail.data.data}
                    />
                  </>
                )}
                {tab === "price" &&
                  me.access.permissions.includes(permissions.pricingView) && (
                    <PriceCheckPanel
                      client={client}
                      productId={detail.data.data.productId}
                    />
                  )}
                {tab === "edit" &&
                  me.access.permissions.includes(permissions.catalogManage) && (
                    <ProductEditor
                      client={client}
                      product={detail.data.data}
                      rowVersion={
                        detail.data.response.headers.get("ETag") ?? ""
                      }
                      onSaved={() => void detail.refetch()}
                    />
                  )}
              </>
            )}
          </section>
        )}
      </div>
    </section>
  );
}

function ProductEditor({
  client,
  product,
  rowVersion,
  onSaved,
}: {
  client: ApiClient;
  product: components["schemas"]["Product"];
  rowVersion: string;
  onSaved: () => void;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const [values, setValues] = useState<ProductUpdate>({
    skuCode: product.skuCode ?? null,
    barcode: product.barcode ?? null,
    canonicalDescription: product.canonicalDescription,
    thicknessMm: product.thicknessMm ?? null,
    widthMm: product.widthMm ?? null,
    lengthMm: product.lengthMm ?? null,
    weightKg: product.weightKg ?? null,
    densityKgM3: product.densityKgM3 ?? null,
    statusCode: product.statusCode ?? null,
  });
  useEffect(() => {
    setValues({
      skuCode: product.skuCode ?? null,
      barcode: product.barcode ?? null,
      canonicalDescription: product.canonicalDescription,
      thicknessMm: product.thicknessMm ?? null,
      widthMm: product.widthMm ?? null,
      lengthMm: product.lengthMm ?? null,
      weightKg: product.weightKg ?? null,
      densityKgM3: product.densityKgM3 ?? null,
      statusCode: product.statusCode ?? null,
    });
  }, [product]);
  const mutation = useMutation({
    mutationFn: () =>
      updateProduct(client, product.productId, rowVersion, values),
    onSuccess: () => {
      onSaved();
      toast.success(txt("Product saved", "تم حفظ المنتج"));
    },
  });
  const field = (
    key: keyof ProductUpdate,
    en: string,
    ar: string,
    required = false,
  ) => (
    <label>
      {txt(en, ar)}
      <input
        required={required}
        value={values[key] ?? ""}
        onChange={(event) => {
          setValues((current) => ({
            ...current,
            [key]: event.target.value || null,
          }));
        }}
      />
    </label>
  );
  return (
    <form
      className="panel create-form product-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!mutation.isPending) mutation.mutate();
      }}
    >
      <h3>{txt("Edit product", "تعديل المنتج")}</h3>
      {field("canonicalDescription", "Description", "الوصف", true)}
      {field("skuCode", "SKU", "كود الصنف")}
      {field("barcode", "Barcode", "الباركود")}
      {field("thicknessMm", "Thickness (mm)", "السُمك (مم)")}
      {field("widthMm", "Width (mm)", "العرض (مم)")}
      {field("lengthMm", "Length (mm)", "الطول (مم)")}
      {field("weightKg", "Weight (kg)", "الوزن (كجم)")}
      {field("densityKgM3", "Density (kg/m³)", "الكثافة (كجم/م³)")}
      <ErrorBanner
        error={mutation.error}
        retry={() => {
          mutation.mutate();
        }}
      />
      <button className="primary" disabled={mutation.isPending}>
        {mutation.isPending
          ? txt("Saving…", "جار الحفظ…")
          : txt("Save product", "حفظ المنتج")}
      </button>
    </form>
  );
}

function EngineeringStudio({
  client,
  product,
}: {
  client: ApiClient;
  product: components["schemas"]["Product"];
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [thickness, setThickness] = useState(18);
  const [width, setWidth] = useState(1220);
  const [length, setLength] = useState(2440);
  const [density, setDensity] = useState(700);
  const [quantity, setQuantity] = useState(1);
  const [priceKg, setPriceKg] = useState(1);
  useEffect(() => {
    setThickness(Number(product.thicknessMm ?? 18));
    setWidth(Number(product.widthMm ?? 1220));
    setLength(Number(product.lengthMm ?? 2440));
    setDensity(Number(product.densityKgM3 ?? 700));
  }, [product]);
  const accounts = useQuery({
    queryKey: ["engineering-accounts"],
    queryFn: () =>
      listAccounts(client, {
        archiveState: "ACTIVE",
        page: 1,
        limit: 25,
        sort: "canonicalName:asc",
      }),
  });
  const projects = useQuery({
    queryKey: ["engineering-projects"],
    queryFn: () =>
      listProjects(client, {
        page: 1,
        limit: 25,
        sort: "updatedAt:desc",
        archiveState: "ACTIVE",
      }),
  });
  const opportunities = useQuery({
    queryKey: ["engineering-opportunities"],
    queryFn: () =>
      listOpportunities(client, {
        page: 1,
        limit: 25,
        sort: "updatedAt:desc",
      }),
  });
  const calculation = useMemo(() => {
    const areaM2 = (width * length) / 1_000_000;
    const volumeM3 = (thickness * width * length) / 1_000_000_000;
    const boardWeightKg = volumeM3 * density;
    const totalWeightKg = boardWeightKg * quantity;
    return {
      areaM2,
      volumeM3,
      boardWeightKg,
      totalWeightKg,
      totalPrice: totalWeightKg * priceKg,
    };
  }, [density, length, priceKg, quantity, thickness, width]);
  const valid = [thickness, width, length, density, quantity, priceKg].every(
    (value) => Number.isFinite(value) && value > 0,
  );
  const setNumber =
    (setter: (value: number) => void) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setter(Number(event.target.value));
    };
  return (
    <section
      className="engineering-studio"
      aria-label={txt("Engineering Studio", "الاستوديو الهندسي")}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow" data-abp-caption>
            {txt("ENGINEERING STUDIO", "الاستوديو الهندسي")}
          </span>
          <h3>
            {txt(
              "Board weight and commercial estimate",
              "حساب وزن اللوح والتكلفة التجارية",
            )}
          </h3>
        </div>
        <span className={`status-chip ${valid ? "active" : "warning"}`}>
          {valid
            ? txt("CALCULATED", "تم الحساب")
            : txt("CHECK INPUTS", "راجع المدخلات")}
        </span>
      </div>
      <div className="engineering-context-grid">
        <label>
          {txt("Customer", "العميل")}
          <select defaultValue="">
            <option value="">{txt("Select customer", "اختر العميل")}</option>
            {accounts.data?.data.map((item) => (
              <option key={item.accountId} value={item.accountId}>
                {item.canonicalName}
              </option>
            ))}
          </select>
        </label>
        <label>
          {txt("Project", "المشروع")}
          <select defaultValue="">
            <option value="">{txt("Select project", "اختر المشروع")}</option>
            {projects.data?.data.map((item) => (
              <option key={item.projectId} value={item.projectId}>
                {item.projectRef}
              </option>
            ))}
          </select>
        </label>
        <label>
          {txt("Opportunity", "الفرصة")}
          <select defaultValue="">
            <option value="">{txt("Select opportunity", "اختر الفرصة")}</option>
            {opportunities.data?.data.map((item) => (
              <option key={item.opportunityId} value={item.opportunityId}>
                {item.opportunityRef}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="engineering-layout">
        <div className="engineering-inputs">
          <NumberField
            label={txt("Thickness (mm)", "السُمك (مم)")}
            value={thickness}
            onChange={setNumber(setThickness)}
          />
          <NumberField
            label={txt("Width (mm)", "العرض (مم)")}
            value={width}
            onChange={setNumber(setWidth)}
          />
          <NumberField
            label={txt("Length (mm)", "الطول (مم)")}
            value={length}
            onChange={setNumber(setLength)}
          />
          <NumberField
            label={txt("Density (kg/m³)", "الكثافة (كجم/م³)")}
            value={density}
            onChange={setNumber(setDensity)}
          />
          <NumberField
            label={txt("Quantity", "الكمية")}
            value={quantity}
            onChange={setNumber(setQuantity)}
          />
          <NumberField
            label={txt("Price / kg", "السعر / كجم")}
            value={priceKg}
            onChange={setNumber(setPriceKg)}
            step="0.01"
          />
        </div>
        <div
          className="engineering-visual"
          aria-label={txt(
            "Scaled board visualization",
            "رسم اللوح حسب الأبعاد",
          )}
        >
          <svg viewBox="0 0 420 230" role="img">
            <defs>
              <linearGradient id="board-face" x1="0" x2="1">
                <stop stopColor="#c81d25" />
                <stop offset="1" stopColor="#0e0b53" />
              </linearGradient>
            </defs>
            <path
              d="M55 72 285 42 368 91 137 123Z"
              fill="url(#board-face)"
              opacity=".92"
            />
            <path d="M137 123 368 91 368 118 137 151Z" fill="#07052f" />
            <path d="M55 72 137 123 137 151 55 99Z" fill="#8f151c" />
            <text x="210" y="188" textAnchor="middle">
              {length.toLocaleString()} × {width.toLocaleString()} ×{" "}
              {thickness.toLocaleString()} mm
            </text>
          </svg>
        </div>
      </div>
      <dl className="engineering-results">
        <Result
          label={txt("Area", "المساحة")}
          value={`${calculation.areaM2.toFixed(3)} m²`}
        />
        <Result
          label={txt("Volume", "الحجم")}
          value={`${calculation.volumeM3.toFixed(4)} m³`}
        />
        <Result
          label={txt("Board weight", "وزن اللوح")}
          value={`${calculation.boardWeightKg.toFixed(2)} kg`}
        />
        <Result
          label={txt("Total weight", "الوزن الإجمالي")}
          value={`${calculation.totalWeightKg.toFixed(2)} kg`}
        />
        <Result
          label={txt("Price by weight", "السعر حسب الوزن")}
          value={calculation.totalPrice.toLocaleString(
            locale === "ar" ? "ar-EG" : "en-US",
            { maximumFractionDigits: 2 },
          )}
        />
      </dl>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = "1",
}: {
  label: string;
  value: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min="0.01"
        step={step}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}

function Result({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
