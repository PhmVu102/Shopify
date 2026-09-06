import type { Config } from "@react-router/dev/config";

export default {
  allowedActionOrigins: [
    "admin.shopify.com",
    "*.myshopify.com",
    "*.spin.dev",
    "**",
  ],
} satisfies Config;
