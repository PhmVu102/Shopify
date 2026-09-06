import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteProductFromWebhook } from "../services/product-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[Webhook] Nhận sự kiện ${topic} từ shop: ${shop}`);

    if (!payload) {
      return new Response("No payload received", { status: 400 });
    }

    const result = await deleteProductFromWebhook(payload);

    console.log(
      `[Webhook] Xử lý thành công products/delete:`,
      result,
    );

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[Webhook] Lỗi xử lý products/delete:", error);
    return new Response(
      error instanceof Error ? error.message : "Internal Server Error",
      { status: 200 },
    );
  }
};
