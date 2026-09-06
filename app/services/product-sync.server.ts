import { createHash } from "node:crypto";
import prisma from "../db.server";
import { generateEmbedding } from "./embedding.server";

type AdminClient = Awaited<
  ReturnType<typeof import("../shopify.server").authenticate.admin>
>["admin"];

export type ShopifyProduct = {
  id: string;
  title: string;
  description: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;

  variants: {
    nodes: ShopifyVariant[];
  };

  media?: {
    nodes: ShopifyMedia[];
  };

  imageUrl?: string | null;
};

export type ShopifyVariant = {
  id: string;
  title: string | null;
  sku: string | null;
  price: string | null;
  compareAtPrice: string | null;
  availableForSale: boolean;
  selectedOptions?: Array<{
    name: string;
    value: string;
  }>;
};

export type ShopifyMedia = {
  id: string;
  alt: string | null;
  image?: {
    url: string;
  } | null;
};

type ProductsResponse = {
  data?: {
    products?: {
      nodes: ShopifyProduct[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
  errors?: Array<{
    message: string;
  }>;
};

/**
 * Tạo đoạn text đại diện cho sản phẩm phục vụ bài toán Vector Search
 * (Bao gồm Title, Vendor, Product Type, Description, Tags, Variants, Price)
 */
export function buildProductSearchText(product: {
  title: string;
  vendor?: string | null;
  productType?: string | null;
  description?: string | null;
  tags?: string[] | string | null;
  variants?: {
    nodes?: ShopifyVariant[];
  } | ShopifyVariant[];
}): string {
  let variantList: ShopifyVariant[] = [];
  if (Array.isArray(product.variants)) {
    variantList = product.variants;
  } else if (product.variants?.nodes) {
    variantList = product.variants.nodes;
  }

  const variantTexts = variantList
    .map((variant) => {
      const options = (variant.selectedOptions ?? [])
        .map((option) => `${option.name}: ${option.value}`)
        .join(", ");

      return [
        variant.title,
        variant.sku ? `SKU: ${variant.sku}` : "",
        variant.price ? `Giá: ${variant.price}` : "",
        options ? `Options: ${options}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .filter(Boolean)
    .join("\n");

  const tagsString = Array.isArray(product.tags)
    ? product.tags.join(", ")
    : product.tags || "";

  return [
    `Tên sản phẩm: ${product.title || ""}`,
    product.vendor ? `Nhà cung cấp: ${product.vendor}` : "",
    product.productType ? `Loại sản phẩm: ${product.productType}` : "",
    product.description ? `Mô tả: ${product.description}` : "",
    tagsString ? `Tags: ${tagsString}` : "",
    variantTexts ? `Biến thể & Giá:\n${variantTexts}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Tính mã băm SHA-256 của đoạn văn bản đại diện cho sản phẩm.
 * Dùng để kiểm tra xem nội dung tìm kiếm có thay đổi không (Mục 6).
 */
export function calculateDataHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Lưu hoặc cập nhật Product và Variant vào Database.
 * Đồng thời kiểm tra dataHash: Nếu thay đổi thì mới gọi API tạo vector (Mục 6).
 */
export async function upsertProduct(product: ShopifyProduct) {
  const searchText = buildProductSearchText(product);
  const dataHash = calculateDataHash(searchText);

  const firstImage =
    product.imageUrl ||
    product.media?.nodes?.find((media) => media.image?.url)?.image?.url ||
    null;

  const tags = Array.isArray(product.tags)
    ? product.tags.length
      ? product.tags.join(", ")
      : null
    : product.tags || null;

  // 1. Kiểm tra sản phẩm đã tồn tại trong DB chưa và đã có vector chưa
  const existing = await prisma.product.findUnique({
    where: {
      shopifyProductId: product.id,
    },
    include: {
      vector: true,
    },
  });

  // 2. Lưu/Cập nhật thông tin Product
  const savedProduct = await prisma.product.upsert({
    where: {
      shopifyProductId: product.id,
    },
    create: {
      shopifyProductId: product.id,
      title: product.title,
      description: product.description || null,
      vendor: product.vendor || null,
      productType: product.productType || null,
      tags,
      imageUrl: firstImage,

      shopifyCreatedAt: new Date(product.createdAt),
      shopifyUpdatedAt: new Date(product.updatedAt),

      syncedAt: new Date(),
      dataHash,
      deletedAt: null,
    },
    update: {
      title: product.title,
      description: product.description || null,
      vendor: product.vendor || null,
      productType: product.productType || null,
      tags,
      imageUrl: firstImage,

      shopifyCreatedAt: new Date(product.createdAt),
      shopifyUpdatedAt: new Date(product.updatedAt),

      syncedAt: new Date(),
      dataHash,
      deletedAt: null,
    },
  });

  // 3. Lưu/Cập nhật Variants
  const variantNodes = product.variants?.nodes ?? [];
  const variantIds = variantNodes.map((variant) => variant.id);

  for (const variant of variantNodes) {
    await prisma.productVariant.upsert({
      where: {
        shopifyVariantId: variant.id,
      },
      create: {
        productId: savedProduct.id,
        shopifyVariantId: variant.id,
        title: variant.title || null,
        sku: variant.sku || null,
        price: variant.price || null,
        compareAtPrice: variant.compareAtPrice || null,
        availableForSale: variant.availableForSale ?? false,
        options: variant.selectedOptions ?? [],
      },
      update: {
        productId: savedProduct.id,
        title: variant.title || null,
        sku: variant.sku || null,
        price: variant.price || null,
        compareAtPrice: variant.compareAtPrice || null,
        availableForSale: variant.availableForSale ?? false,
        options: variant.selectedOptions ?? [],
      },
    });
  }

  // Dọn dẹp các variant cũ không còn tồn tại
  if (variantIds.length > 0) {
    await prisma.productVariant.deleteMany({
      where: {
        productId: savedProduct.id,
        shopifyVariantId: {
          notIn: variantIds,
        },
      },
    });
  } else {
    await prisma.productVariant.deleteMany({
      where: {
        productId: savedProduct.id,
      },
    });
  }

  // 4. Quản lý Vector & Tối ưu hóa data_hash (Mục 3 & Mục 6)
  let vectorStatus: "created" | "updated" | "skipped" = "skipped";
  const needsEmbedding =
    !existing || !existing.vector || existing.dataHash !== dataHash;

  if (needsEmbedding) {
    try {
      const { embedding, model, dimensions } =
        await generateEmbedding(searchText);

      await prisma.productVector.upsert({
        where: {
          productId: savedProduct.id,
        },
        create: {
          productId: savedProduct.id,
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

      vectorStatus = existing?.vector ? "updated" : "created";
      console.log(
        `[ProductSync] [${vectorStatus.toUpperCase()}] Vector cho sản phẩm: "${savedProduct.title}" (${savedProduct.shopifyProductId})`,
      );
    } catch (err) {
      console.error(
        `[ProductSync] Lỗi sinh embedding cho sản phẩm ${savedProduct.id}:`,
        err,
      );
    }
  } else {
    vectorStatus = "skipped";
    console.log(
      `[ProductSync] [SKIPPED] dataHash không đổi, bỏ qua sinh vector: "${savedProduct.title}"`,
    );
  }

  return {
    productId: savedProduct.id,
    shopifyProductId: product.id,
    title: product.title,
    dataHash,
    variantCount: variantNodes.length,
    vectorStatus,
  };
}

/**
 * Xử lý webhook khi Product được tạo hoặc cập nhật từ Shopify (Mục 5)
 * Shopify Webhook gửi payload ở định dạng REST JSON
 */
export async function upsertProductFromWebhook(payload: any) {
  if (!payload || !payload.id) {
    throw new Error("Payload webhook không hợp lệ (thiếu id).");
  }

  const rawId = String(payload.id);
  const gid = rawId.startsWith("gid://shopify/Product/")
    ? rawId
    : `gid://shopify/Product/${rawId}`;

  // Chuẩn hóa variants từ webhook payload
  const variants: ShopifyVariant[] = (payload.variants || []).map((v: any) => {
    const vRawId = String(v.id);
    const vGid = vRawId.startsWith("gid://shopify/ProductVariant/")
      ? vRawId
      : `gid://shopify/ProductVariant/${vRawId}`;

    return {
      id: vGid,
      title: v.title || null,
      sku: v.sku || null,
      price: v.price != null ? String(v.price) : null,
      compareAtPrice:
        v.compare_at_price != null ? String(v.compare_at_price) : null,
      availableForSale: (v.inventory_quantity ?? 1) > 0,
      selectedOptions: (v.options || []).map((optVal: string, idx: number) => ({
        name: payload.options?.[idx]?.name || `Option ${idx + 1}`,
        value: String(optVal),
      })),
    };
  });

  // Lấy ảnh đầu tiên từ images
  const firstImageUrl =
    payload.image?.src ||
    (payload.images && payload.images[0]?.src) ||
    null;

  const tagsArray = typeof payload.tags === "string"
    ? payload.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
    : Array.isArray(payload.tags)
    ? payload.tags
    : [];

  const normalizedProduct: ShopifyProduct = {
    id: gid,
    title: payload.title || "Untitled Product",
    description: payload.body_html || null,
    vendor: payload.vendor || null,
    productType: payload.product_type || null,
    tags: tagsArray,
    createdAt: payload.created_at || new Date().toISOString(),
    updatedAt: payload.updated_at || new Date().toISOString(),
    variants: {
      nodes: variants,
    },
    imageUrl: firstImageUrl,
  };

  return await upsertProduct(normalizedProduct);
}

/**
 * Xử lý webhook khi Product bị xóa từ Shopify (Mục 5)
 * Soft-delete product và loại bỏ vector tương ứng
 */
export async function deleteProductFromWebhook(payload: any) {
  if (!payload || !payload.id) {
    throw new Error("Payload webhook delete không hợp lệ (thiếu id).");
  }

  const rawId = String(payload.id);
  const gid = rawId.startsWith("gid://shopify/Product/")
    ? rawId
    : `gid://shopify/Product/${rawId}`;

  // Tìm sản phẩm
  const product = await prisma.product.findFirst({
    where: {
      OR: [{ shopifyProductId: gid }, { shopifyProductId: rawId }],
    },
  });

  if (!product) {
    console.log(`[ProductSync] Webhook delete: Không tìm thấy sản phẩm ${gid} trong DB.`);
    return { deleted: false };
  }

  // Soft-delete sản phẩm
  await prisma.product.update({
    where: { id: product.id },
    data: {
      deletedAt: new Date(),
    },
  });

  // Xóa vector tương ứng để loại bỏ khỏi semantic search
  await prisma.productVector.deleteMany({
    where: {
      productId: product.id,
    },
  });

  console.log(
    `[ProductSync] [DELETED] Đã soft-delete và xóa vector của sản phẩm: "${product.title}" (${product.shopifyProductId})`,
  );

  return { deleted: true, productId: product.id };
}

/**
 * Đồng bộ toàn bộ sản phẩm từ Shopify với xử lý Cursor Pagination (Mục 2.2)
 */
export async function syncAllProducts(admin: AdminClient) {
  let cursor: string | null = null;

  let totalProducts = 0;
  let totalVariants = 0;
  let vectorsCreated = 0;
  let vectorsUpdated = 0;
  let vectorsSkipped = 0;
  let pageCount = 0;

  do {
    pageCount++;

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

              variants(first: 100) {
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
        }
      `,
      {
        variables: {
          first: 50,
          after: cursor,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Shopify GraphQL request failed with HTTP ${response.status}`,
      );
    }

    const responseJson =
      (await response.json()) as ProductsResponse;

    if (responseJson.errors?.length) {
      throw new Error(
        responseJson.errors.map((error) => error.message).join("; "),
      );
    }

    const products = responseJson.data?.products;

    if (!products) {
      throw new Error("Shopify returned no products data.");
    }

    for (const product of products.nodes) {
      const result = await upsertProduct(product);

      totalProducts++;
      totalVariants += result.variantCount;

      if (result.vectorStatus === "created") vectorsCreated++;
      else if (result.vectorStatus === "updated") vectorsUpdated++;
      else vectorsSkipped++;
    }

    cursor = products.pageInfo.endCursor;

    console.log(
      `[ProductSync] Trang ${pageCount} hoàn tất. ` +
        `Sản phẩm: ${products.nodes.length}, ` +
        `hasNextPage: ${products.pageInfo.hasNextPage}`,
    );

    if (!products.pageInfo.hasNextPage) {
      break;
    }
  } while (cursor);

  return {
    totalProducts,
    totalVariants,
    vectorsCreated,
    vectorsUpdated,
    vectorsSkipped,
    pageCount,
  };
}
