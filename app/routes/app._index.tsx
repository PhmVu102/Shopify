import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";

import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { syncAllProducts } from "../services/product-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const result = await syncAllProducts(admin);

    return {
      success: true as const,
      ...result,
    };
  } catch (error) {
    console.error("[ProductSync] Failed:", error);

    return {
      success: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Đồng bộ sản phẩm thất bại.",
    };
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
  `#graphql
    query GetProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        nodes {
          id
          title
          description
          vendor
          productType
          tags
          createdAt
          updatedAt

          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
            maxVariantPrice {
              amount
              currencyCode
            }
          }

          variants(first: 20) {
            nodes {
              id
              title
              sku
              price
              compareAtPrice
              availableForSale
              selectedOptions {
                name
                value
              }
            }
          }

          media(first: 5) {
            nodes {
              id
              alt
              ... on MediaImage {
                image {
                  url
                }
              }
            }
          }
        }

        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }`,
  {
    variables: {
      first: 50,
      after: null,
    },
  },
);

  const responseJson = await response.json();

return {
  products: responseJson.data?.products?.nodes ?? [],
  pageInfo: responseJson.data?.products?.pageInfo,
};
};

function formatMoney(amount: string, currencyCode: string) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: currencyCode,
  }).format(Number(amount));
}

export default function Index() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isSyncing = fetcher.state === "submitting" || fetcher.state === "loading";

  return (
    <s-page heading="VUCCI Product Search">
      <s-button
        slot="primary-action"
        onClick={() => {
          fetcher.submit(
            {},
            {
              method: "POST",
              action: "?index",
            },
          );
        }}
        {...(isSyncing ? { loading: true } : {})}
      >
        {isSyncing ? "Đang đồng bộ..." : "Sync Products"}
      </s-button>

      {fetcher.data?.success && (
        <s-banner tone="success">
          Đã đồng bộ {fetcher.data.totalProducts} sản phẩm và{" "}
          {fetcher.data.totalVariants} biến thể. (Vector mới: {fetcher.data.vectorsCreated}, Cập nhật: {fetcher.data.vectorsUpdated}, Bỏ qua do dataHash không đổi: {fetcher.data.vectorsSkipped})
        </s-banner>
      )}

      {fetcher.data?.success === false && (
        <s-banner tone="critical">
          Đồng bộ thất bại: {fetcher.data.error}
        </s-banner>
      )}

      <s-section heading={`Products (${products.length})`}>
        {products.length === 0 ? (
          <s-paragraph>
            Không tìm thấy sản phẩm nào trong Shopify.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {products.map((product: any) => {
              const firstImage = product.media?.nodes?.find(
                (media: any) => media.image?.url,
              );

              return (
                <s-box
                  key={product.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack direction="block" gap="base">
                    {/* Image */}
                    {firstImage?.image?.url && (
                      <img
                        src={firstImage.image.url}
                        alt={firstImage.alt || product.title}
                        style={{
                          width: "180px",
                          height: "180px",
                          objectFit: "cover",
                          borderRadius: "8px",
                        }}
                      />
                    )}

                    {/* Basic information */}
                    <s-heading>{product.title}</s-heading>

                    <s-text>
                      Shopify Product ID: {product.id}
                    </s-text>

                    <s-text>
                      Vendor: {product.vendor || "—"}
                    </s-text>

                    <s-text>
                      Product Type: {product.productType || "—"}
                    </s-text>

                    <s-text>
                      Description: {product.description || "—"}
                    </s-text>

                    {/* Tags */}
                    <s-text>
                      Tags:{" "}
                      {product.tags?.length
                        ? product.tags.join(", ")
                        : "—"}
                    </s-text>

                    {/* Price */}
                    <s-text>
                      Price:{" "}
                      {product.priceRangeV2?.minVariantPrice &&
                      product.priceRangeV2?.maxVariantPrice
                        ? `${formatMoney(
                            product.priceRangeV2.minVariantPrice.amount,
                            product.priceRangeV2.minVariantPrice.currencyCode,
                          )} - ${formatMoney(
                            product.priceRangeV2.maxVariantPrice.amount,
                            product.priceRangeV2.maxVariantPrice.currencyCode,
                          )}`
                        : "—"}
                    </s-text>

                    {/* Variants */}
                    <s-heading>Variants</s-heading>

                    {product.variants?.nodes?.length ? (
                      <s-stack direction="block" gap="small">
                        {product.variants.nodes.map((variant: any) => (
                          <s-box
                            key={variant.id}
                            padding="small"
                            borderWidth="base"
                            borderRadius="base"
                          >
                            <s-stack direction="block" gap="small">
                              <s-text>
                                {variant.title || "Default Variant"}
                              </s-text>

                              <s-text>
                                SKU: {variant.sku || "—"}
                              </s-text>

                              <s-text>
                                Price:{" "}
                                {variant.price
                                  ? formatMoney(
                                      variant.price,
                                      product.priceRangeV2
                                        ?.minVariantPrice?.currencyCode ||
                                        "VND",
                                    )
                                  : "—"}
                              </s-text>

                              <s-text>
                                Available for sale:{" "}
                                {variant.availableForSale
                                  ? "Có"
                                  : "Không"}
                              </s-text>

                              {variant.selectedOptions?.length > 0 && (
                                <s-text>
                                  Options:{" "}
                                  {variant.selectedOptions
                                    .map(
                                      (option: any) =>
                                        `${option.name}: ${option.value}`,
                                    )
                                    .join(", ")}
                                </s-text>
                              )}
                            </s-stack>
                          </s-box>
                        ))}
                      </s-stack>
                    ) : (
                      <s-text>Không có variant.</s-text>
                    )}

                    {/* Dates */}
                    <s-text>
                      Created At: {product.createdAt}
                    </s-text>

                    <s-text>
                      Updated At: {product.updatedAt}
                    </s-text>
                  </s-stack>
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (
  headersArgs: Parameters<typeof boundary.headers>[0],
) => {
  return boundary.headers(headersArgs);
};
