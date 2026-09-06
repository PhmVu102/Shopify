import prisma from "../db.server";
import { cosineSimilarity, generateEmbedding } from "./embedding.server";

export type SearchResultItem = {
  id: string;
  shopifyProductId: string;
  title: string;
  description: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string | null;
  imageUrl: string | null;
  price: string;
  similarityScore: number;
  similarityPercentage: string;
  variants: Array<{
    id: string;
    title: string | null;
    price: string | null;
    sku: string | null;
  }>;
};

export type SearchResult = {
  query: string;
  totalIndexed: number;
  results: SearchResultItem[];
  modelUsed: string;
};

/**
 * Tìm kiếm sản phẩm theo ngữ nghĩa (Semantic Search) bằng Vector Cosine Similarity
 * @param query Chuỗi tìm kiếm (ví dụ: "áo nam màu đen dưới 500k")
 * @param limit Số lượng sản phẩm trả về tối thiểu (mặc định 5)
 */
export async function searchProductsBySemantic(
  query: string,
  limit = 5,
): Promise<SearchResult> {
  const trimmedQuery = query?.trim();

  if (!trimmedQuery) {
    return {
      query: "",
      totalIndexed: 0,
      results: [],
      modelUsed: "none",
    };
  }

  // 1. Chuyển đổi câu truy vấn thành Vector Embedding
  const { embedding: queryEmbedding, model: modelUsed } =
    await generateEmbedding(trimmedQuery);

  // 2. Lấy tất cả vector của các sản phẩm còn hoạt động (chưa bị xóa)
  const productVectors = await prisma.productVector.findMany({
    where: {
      product: {
        deletedAt: null,
      },
    },
    include: {
      product: {
        include: {
          variants: true,
        },
      },
    },
  });

  if (productVectors.length === 0) {
    return {
      query: trimmedQuery,
      totalIndexed: 0,
      results: [],
      modelUsed,
    };
  }

  // 3. Tính toán Cosine Similarity cho từng sản phẩm
  const scoredItems: Array<{
    score: number;
    vectorItem: (typeof productVectors)[0];
  }> = [];

  for (const item of productVectors) {
    try {
      const storedVector = JSON.parse(item.embedding) as number[];
      const score = cosineSimilarity(queryEmbedding, storedVector);

      scoredItems.push({
        score,
        vectorItem: item,
      });
    } catch (err) {
      console.error(
        `[VectorSearch] Lỗi đọc vector của sản phẩm ${item.productId}:`,
        err,
      );
    }
  }

  // 4. Sắp xếp giảm dần theo điểm tương đồng (Similarity score)
  scoredItems.sort((a, b) => b.score - a.score);

  // 5. Lấy Top N sản phẩm phù hợp nhất (tối thiểu 5)
  const topResults = scoredItems.slice(0, Math.max(limit, 5));

  // 6. Định dạng kết quả trả về theo đúng yêu cầu đề bài
  const results: SearchResultItem[] = topResults.map(({ score, vectorItem }) => {
    const p = vectorItem.product;

    // Tìm giá nhỏ nhất từ các variant
    let displayPrice = "—";
    const prices = p.variants
      .map((v) => (v.price ? Number(v.price) : null))
      .filter((price): price is number => price !== null && !isNaN(price));

    if (prices.length > 0) {
      const minPrice = Math.min(...prices);
      displayPrice = new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
      }).format(minPrice);
    }

    // Định dạng điểm tương đồng dưới dạng phần trăm hiển thị trực quan
    const boundedScore = Math.max(0, Math.min(1, (score + 1) / 2)); // Chuyển từ [-1, 1] sang [0, 1]
    const percentage = `${(boundedScore * 100).toFixed(1)}%`;

    return {
      id: p.id,
      shopifyProductId: p.shopifyProductId,
      title: p.title,
      description: p.description,
      vendor: p.vendor,
      productType: p.productType,
      tags: p.tags,
      imageUrl: p.imageUrl,
      price: displayPrice,
      similarityScore: Number(score.toFixed(4)),
      similarityPercentage: percentage,
      variants: p.variants.map((v) => ({
        id: v.id,
        title: v.title,
        price: v.price ? v.price.toString() : null,
        sku: v.sku,
      })),
    };
  });

  return {
    query: trimmedQuery,
    totalIndexed: productVectors.length,
    results,
    modelUsed,
  };
}
