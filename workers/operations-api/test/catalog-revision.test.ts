import assert from "node:assert/strict";
import test from "node:test";
import { shouldCreateCatalogRevision } from "../src/catalog-revision";

test("the first Catalog publication creates a revision",()=>{
  assert.equal(shouldCreateCatalogRevision(null,"hash-a"),true);
});

test("an unchanged latest Catalog snapshot reuses the latest revision",()=>{
  assert.equal(shouldCreateCatalogRevision("hash-a","hash-a"),false);
});

test("returning to a historical snapshot after an intervening change creates a new revision",()=>{
  assert.equal(shouldCreateCatalogRevision("hash-b","hash-a"),true);
});
