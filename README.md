# VUCCI Shopify App
# Product Synchronization & Semantic Vector Search

VUCCI là một Shopify Embedded App được xây dựng để đồng bộ dữ liệu sản phẩm từ Shopify, lưu trữ dữ liệu nội bộ, chuyển đổi dữ liệu sản phẩm thành văn bản đại diện, sinh Embedding Vector và thực hiện tìm kiếm sản phẩm theo ngữ nghĩa (Semantic Search).

Dự án được xây dựng theo yêu cầu của bài test:

> Product Synchronization & Vector Search

---

# 1. Mục tiêu dự án

Mục tiêu của ứng dụng là xây dựng một pipeline hoàn chỉnh:

```text
Shopify Product
      ↓
Shopify Admin GraphQL API
      ↓
Product Synchronization
      ↓
Database
      ↓
Product Search Text
      ↓
Embedding
      ↓
Vector Storage
      ↓
Semantic Search
      ↓
Top 5 Products
