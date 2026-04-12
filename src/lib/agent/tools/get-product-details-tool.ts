import { tool } from "ai";
import { getProductDetailsInput, getProductDetails } from "../../tools/get-product-details";

export const getProductDetailsTool = tool({
  description:
    "Get the full record for a single product by its internal ID. Returns unit hierarchy, MDR class, price, GTIN, and all catalog fields.",
  inputSchema: getProductDetailsInput,
  execute: async (input) => {
    const details = await getProductDetails(input.internalId);
    return { product: details };
  },
});
