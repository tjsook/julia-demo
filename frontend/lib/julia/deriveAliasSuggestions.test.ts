import assert from "node:assert/strict";
import test from "node:test";

import { deriveAliasSuggestions } from "./deriveAliasSuggestions.ts";

test("deriveAliasSuggestions returns no suggestions for an empty title", () => {
  assert.deepEqual(deriveAliasSuggestions(""), []);
});

test("deriveAliasSuggestions returns one normalized token for a single-word title", () => {
  assert.deepEqual(deriveAliasSuggestions("Roi"), ["roi"]);
});

test("deriveAliasSuggestions returns all contiguous phrases for a three-word title", () => {
  assert.deepEqual(deriveAliasSuggestions("ROI Calculator context"), [
    "roi calculator context",
    "roi calculator",
    "calculator context",
    "roi",
    "calculator",
    "context",
  ]);
});

test("deriveAliasSuggestions truncates long titles to the ten longest phrases", () => {
  assert.deepEqual(
    deriveAliasSuggestions("Comprehensive Operational Excellence Strategy Document"),
    [
      "comprehensive operational excellence strategy document",
      "comprehensive operational excellence strategy",
      "operational excellence strategy document",
      "comprehensive operational excellence",
      "operational excellence strategy",
      "excellence strategy document",
      "comprehensive operational",
      "operational excellence",
      "excellence strategy",
      "strategy document",
    ],
  );
});

test("deriveAliasSuggestions strips punctuation before deriving aliases", () => {
  assert.deepEqual(deriveAliasSuggestions("ROI: Q2 Meiborg (final)"), [
    "roi q2 meiborg final",
    "roi q2 meiborg",
    "q2 meiborg final",
    "roi q2",
    "q2 meiborg",
    "meiborg final",
    "roi",
    "q2",
    "meiborg",
    "final",
  ]);
});

test("deriveAliasSuggestions deduplicates repeated-token aliases", () => {
  assert.deepEqual(deriveAliasSuggestions("ROI ROI"), ["roi"]);
});
