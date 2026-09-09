import test from "node:test";
import assert from "node:assert/strict";
import { marketingRoutes, productMenuItems, marketingFooterGroups } from "../src/marketing/config.ts";

test("marketingRoutes exposes public ITSM landing route", () => {
  assert.equal(marketingRoutes.itsm, "/itsm");
  assert.equal(marketingRoutes.product, "/product");
});

test("productMenuItems contains all 5 approved products including AuthClaw ITSM", () => {
  assert.equal(productMenuItems.length, 5);

  const labels = productMenuItems.map((item) => item.label);
  assert.deepEqual(labels, [
    "In-line gateway",
    "Agentic remediation",
    "Audit & trust center",
    "Framework scoring",
    "AuthClaw ITSM",
  ]);

  // Existing products route to /product
  assert.equal(productMenuItems[0].href, "/product");
  assert.equal(productMenuItems[1].href, "/product");
  assert.equal(productMenuItems[2].href, "/product");
  assert.equal(productMenuItems[3].href, "/product");

  // AuthClaw ITSM routes to /itsm
  assert.equal(productMenuItems[4].href, "/itsm");
  assert.equal(productMenuItems[4].badge, "New");
});

test("marketingFooterGroups includes AuthClaw ITSM under Product heading", () => {
  const productGroup = marketingFooterGroups.find((group) => group.heading === "Product");
  assert.ok(productGroup, "Product footer group must exist");

  const itsmLink = productGroup.links.find((link) => link.label === "AuthClaw ITSM");
  assert.ok(itsmLink, "AuthClaw ITSM footer link must exist");
  assert.equal(itsmLink.href, "/itsm");
});
