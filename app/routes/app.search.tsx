import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { searchProductsBySemantic } from "../services/vector-search.server";
import { generateEmbedding } from "../services/embedding.server";
import { buildProductSearchText, calculateDataHash } from "../services/product-sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";

  const productCount = await prisma.product.count({
    where: { deletedAt: null },
  });

  const vectorCount = await prisma.productVector.count({
    where: {
      product: {
        deletedAt: null,
      },
    },
  });

  let searchResult = null;
  if (query.trim()) {
    searchResult = await searchProductsBySemantic(query, 5);
  }

  return {
    query,
    productCount,
    vectorCount,
    searchResult,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  try {
    // Backfill: Tạo vector cho tất cả sản phẩm đang có trong database chưa có vector
    const products = await prisma.product.findMany({
      where: { deletedAt: null },
      include: {
        variants: true,
        vector: true,
      },
    });

    let generatedCount = 0;
    let skippedCount = 0;

    for (const product of products) {
      const searchText = buildProductSearchText({
        title: product.title,
        vendor: product.vendor,
        productType: product.productType,
        description: product.description,
        tags: product.tags,
        variants: product.variants.map((v) => ({
          id: v.shopifyVariantId,
          title: v.title,
          sku: v.sku,
          price: v.price ? v.price.toString() : null,
          compareAtPrice: v.compareAtPrice ? v.compareAtPrice.toString() : null,
          availableForSale: v.availableForSale,
        })),
      });

      const dataHash = calculateDataHash(searchText);

      if (!product.vector || product.dataHash !== dataHash) {
        const { embedding, model, dimensions } = await generateEmbedding(searchText);

        await prisma.productVector.upsert({
          where: { productId: product.id },
          create: {
            productId: product.id,
            embedding: JSON.stringify(embedding),
            model,
            dimensions,
          },
          update: {
            embedding: JSON.stringify(embedding),
            model,
            dimensions,
          },
        });

        await prisma.product.update({
          where: { id: product.id },
          data: { dataHash },
        });

        generatedCount++;
      } else {
        skippedCount++;
      }
    }

    return {
      success: true,
      generatedCount,
      skippedCount,
      total: products.length,
    };
  } catch (error) {
    console.error("[VectorBackfill] Thất bại:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Tạo vector thất bại",
    };
  }
};

export default function SearchPage() {
  const { query, productCount, vectorCount, searchResult } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const fetcher = useFetcher<typeof action>();

  const isSearching =
    navigation.state === "loading" &&
    navigation.location.pathname === "/app/search";
  const isBackfilling =
    fetcher.state === "submitting" || fetcher.state === "loading";

  const sampleQueries = [
    "áo nam màu đen dưới 500k",
    "snowboard mùa đông cao cấp",
    "gift card quà tặng",
    "phụ kiện thể thao",
  ];

  return (
    <s-page heading="Product Semantic Search">
      {/* Thông báo trạng thái cơ sở dữ liệu Vector */}
      {vectorCount === 0 && productCount > 0 && (
        <s-banner tone="warning">
          <s-stack direction="block" gap="small">
            <s-text>
              Hiện có {productCount} sản phẩm trong cơ sở dữ liệu nhưng chưa có
              Vector Embedding nào.
            </s-text>
            <fetcher.Form method="post">
              <s-button type="submit" {...(isBackfilling ? { loading: true } : {})}>
                {isBackfilling
                  ? "Đang tạo vector..."
                  : "Tạo Vector Ngay Cho Tất Cả Sản Phẩm"}
              </s-button>
            </fetcher.Form>
          </s-stack>
        </s-banner>
      )}

      {fetcher.data?.success && (
        <s-banner tone="success">
          Đã tạo vector thành công: {fetcher.data.generatedCount} sản phẩm mới,{" "}
          {fetcher.data.skippedCount} sản phẩm được bỏ qua (dataHash không đổi).
        </s-banner>
      )}

      {fetcher.data?.success === false && (
        <s-banner tone="critical">Lỗi: {fetcher.data.error}</s-banner>
      )}

      {/* Khung tìm kiếm */}
      <s-section heading="Tìm Kiếm Sản Phẩm Bằng Ngữ Nghĩa">
        <s-paragraph>
          Hệ thống chuyển đổi từ khóa tự nhiên thành vector embedding và tính toán
          Cosine Similarity để gợi ý Top 5 sản phẩm phù hợp nhất.
        </s-paragraph>

        <Form method="get" style={{ marginTop: "1rem", marginBottom: "1rem" }}>
          <s-stack direction="block" gap="base">
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <input
                type="text"
                name="q"
                defaultValue={query}
                placeholder="Nhập truy vấn tự nhiên (ví dụ: áo nam màu đen dưới 500k)..."
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  fontSize: "15px",
                  outline: "none",
                }}
              />
              <s-button type="submit" {...(isSearching ? { loading: true } : {})}>
                {isSearching ? "Đang tìm..." : "Tìm kiếm"}
              </s-button>
            </div>

            {/* Gợi ý truy vấn mẫu */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <s-text>Gợi ý thử nghiệm: </s-text>
              {sampleQueries.map((sample) => (
                <a
                  key={sample}
                  href={`/app/search?q=${encodeURIComponent(sample)}`}
                  style={{
                    fontSize: "13px",
                    color: "#2563eb",
                    backgroundColor: "#eff6ff",
                    padding: "4px 10px",
                    borderRadius: "16px",
                    textDecoration: "none",
                    border: "1px solid #bfdbfe",
                  }}
                >
                  {sample}
                </a>
              ))}
            </div>
          </s-stack>
        </Form>
      </s-section>

      {/* Kết quả tìm kiếm */}
      {searchResult && (
        <s-section
          heading={`Kết Quả Tìm Kiếm (${searchResult.results.length} sản phẩm) - Model: ${searchResult.modelUsed}`}
        >
          {searchResult.results.length === 0 ? (
            <s-banner tone="info">
              Không tìm thấy sản phẩm nào phù hợp với từ khóa "{query}". Hãy thử
              tìm kiếm từ khóa khác.
            </s-banner>
          ) : (
            <s-stack direction="block" gap="base">
              {searchResult.results.map((product, index) => (
                <s-box
                  key={product.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <div
                    style={{
                      display: "flex",
                      gap: "20px",
                      alignItems: "flex-start",
                    }}
                  >
                    {/* Rank Badge */}
                    <div
                      style={{
                        minWidth: "36px",
                        height: "36px",
                        borderRadius: "50%",
                        backgroundColor: index === 0 ? "#10b981" : "#6b7280",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: "bold",
                        fontSize: "16px",
                      }}
                    >
                      #{index + 1}
                    </div>

                    {/* Product Image */}
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.title}
                        style={{
                          width: "120px",
                          height: "120px",
                          objectFit: "cover",
                          borderRadius: "8px",
                          border: "1px solid #e5e7eb",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "120px",
                          height: "120px",
                          backgroundColor: "#f3f4f6",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#9ca3af",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      >
                        Không có ảnh
                      </div>
                    )}

                    {/* Product Details */}
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "6px",
                        }}
                      >
                        <s-heading>{product.title}</s-heading>

                        {/* Similarity Score Badge (Mục 4) */}
                        <div
                          style={{
                            backgroundColor:
                              product.similarityScore > 0.6
                                ? "#d1fae5"
                                : product.similarityScore > 0.3
                                ? "#fef3c7"
                                : "#f3f4f6",
                            color:
                              product.similarityScore > 0.6
                                ? "#065f46"
                                : product.similarityScore > 0.3
                                ? "#92400e"
                                : "#374151",
                            padding: "4px 12px",
                            borderRadius: "12px",
                            fontWeight: "600",
                            fontSize: "13px",
                            border: "1px solid rgba(0,0,0,0.05)",
                          }}
                        >
                          Độ tương đồng: {product.similarityPercentage} (Score:{" "}
                          {product.similarityScore})
                        </div>
                      </div>

                      {/* Price (Mục 4) */}
                      <p style={{ margin: "4px 0", fontSize: "16px", fontWeight: "bold", color: "#b91c1c" }}>
                        Giá: {product.price}
                      </p>

                      <s-text>
                        <strong>Shopify ID:</strong> {product.shopifyProductId}
                      </s-text>

                      {product.vendor && (
                        <s-text> | <strong>Vendor:</strong> {product.vendor}</s-text>
                      )}

                      {product.productType && (
                        <s-text> | <strong>Loại:</strong> {product.productType}</s-text>
                      )}

                      {product.tags && (
                        <p style={{ margin: "4px 0", fontSize: "13px", color: "#4b5563" }}>
                          <strong>Tags:</strong> {product.tags}
                        </p>
                      )}

                      {product.description && (
                        <p
                          style={{
                            margin: "6px 0",
                            fontSize: "13px",
                            color: "#6b7280",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {product.description}
                        </p>
                      )}

                      {/* Variants */}
                      {product.variants.length > 0 && (
                        <div style={{ marginTop: "6px", fontSize: "12px", color: "#6b7280" }}>
                          <strong>Biến thể ({product.variants.length}):</strong>{" "}
                          {product.variants
                            .map((v) => v.title)
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                  </div>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
