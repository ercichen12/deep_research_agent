import { describe, expect, it } from "vitest";
import { selectSourcesForRead } from "@/lib/heavy/graph/source-selector";
import type { HeavySearchResult } from "@/lib/heavy/types";

describe("Graph Heavy source selector", () => {
  it("prefers customs and trade-data sources over generic customer-data-platform matches for HS8542 workflow tasks", () => {
    const selected = selectSourcesForRead({
      expectedSignals: ["HS8542 customs data cleaning", "importer exporter entity resolution and merge", "customer segmentation and tiering"],
      limit: 2,
      results: [
        result(
          "Architecting the Next-Generation Customer Tiering System",
          "https://techcommunity.microsoft.com/customer-tiering",
          "customer segmentation and tiering for marketing data"
        ),
        result(
          "Customer.io Docs | Storage data warehouse integrations",
          "https://docs.customer.io/integrations/data-warehouses",
          "customer data platform warehouse integration"
        ),
        result(
          "HS8542 customs import data by importer and exporter",
          "https://trade.example/hs8542-import-data",
          "HS8542 customs import data importer exporter bill of lading semiconductor trade data"
        ),
        result(
          "Harmonized System HS code trade data entity matching",
          "https://customs.example/hs-code-entity-resolution",
          "customs trade data entity resolution importer consignee exporter matching"
        )
      ]
    });

    expect(selected.map((item) => item.url)).toEqual([
      "https://trade.example/hs8542-import-data",
      "https://customs.example/hs-code-entity-resolution"
    ]);
  });
});

function result(title: string, url: string, snippet: string): HeavySearchResult {
  return {
    title,
    url,
    snippet,
    provider: "opencli",
    engine: "google"
  };
}
