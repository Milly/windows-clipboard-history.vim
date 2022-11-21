import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";
import { JSONDecodeStream } from "./json.ts";

Deno.test("[json] JSONDecodeStream", async (t) => {
  await t.step("chunks", async () => {
    const textStream = new ReadableStream({
      start(controller) {
        controller.enqueue("42\n");
        controller.enqueue('"foo"\n');
        controller.enqueue('["bar", 123.5]\n');
        controller.enqueue('{"qux": 255, "a": {"b": 21}}\n');
        controller.close();
      },
    });

    const objs = [];
    for await (const chunk of textStream.pipeThrough(new JSONDecodeStream())) {
      objs.push(chunk);
    }
    assertEquals(objs, [
      42,
      "foo",
      ["bar", 123.5],
      { "qux": 255, "a": { "b": 21 } },
    ]);
  });

  await t.step("divided object", async () => {
    const textStream = new ReadableStream({
      start(controller) {
        controller.enqueue('{"qux": 255,\n');
        controller.enqueue('"a": {"b": 21}}\n');
        controller.close();
      },
    });

    const objs = [];
    for await (const chunk of textStream.pipeThrough(new JSONDecodeStream())) {
      objs.push(chunk);
    }
    assertEquals(objs, [
      { "qux": 255, "a": { "b": 21 } },
    ]);
  });

  await t.step("LF in middle of chunk", async () => {
    const textStream = new ReadableStream({
      start(controller) {
        controller.enqueue('"foo"\n"bar"\n');
        controller.close();
      },
    });

    const objs = [];
    for await (const chunk of textStream.pipeThrough(new JSONDecodeStream())) {
      objs.push(chunk);
    }
    assertEquals(objs, [
      "foo",
      "bar",
    ]);
  });
});
