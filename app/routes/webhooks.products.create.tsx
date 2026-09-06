import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { upsertProductFromWebhook } from "../services/product-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[Webhook] Nhận sự kiện ${topic} từ shop: ${shop}`);

    if (!payload) {
      return new Response("No payload received", { status: 400 });
    }

    const result = await upsertProductFromWebhook(payload);

    console.log(
      `[Webhook] Xử lý thành công products/create: "${result.title}" (Vector: ${result.vectorStatus})`,
    );

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[Webhook] Lỗi xử lý products/create:", error);
    // Trả về 200 để tránh Shopify retry vô tận nếu là lỗi định dạng dữ liệu payload
    return new Response(
      error instanceof Error ? error.message : "Internal Server Error",
      { status: 200 },
    );
  }
};
