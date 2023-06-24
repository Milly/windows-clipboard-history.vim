import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { toDuration } from "./time.ts";

Deno.test("[time] toDuration", async (t) => {
  await t.step("seconds", () => {
    assertEquals(toDuration(12800), "12s");
  });

  await t.step("minutes", () => {
    assertEquals(toDuration(1290000), "21m");
  });

  await t.step("hours", () => {
    assertEquals(toDuration(31680000), "8h");
  });

  await t.step("days", () => {
    assertEquals(toDuration(267840000), "3d");
  });

  await t.step("inverse", () => {
    assertEquals(toDuration(-1290000), "21m");
  });

  await t.step("zero", () => {
    assertEquals(toDuration(0), "0s");
  });
});
