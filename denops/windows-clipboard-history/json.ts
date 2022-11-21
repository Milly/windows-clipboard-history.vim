export class JSONDecodeStream extends TransformStream<string, unknown> {
  #buf = "";

  constructor() {
    super({
      transform: (chunk, controller) => this.#handle(chunk, controller),
    });
  }

  #handle(
    chunk: string,
    controller: TransformStreamDefaultController<unknown>,
  ) {
    this.#buf += chunk;
    const lines = this.#buf.split("\n");
    let jsonStr = "";
    let nextIdx = 0;
    for (let i = 0; i < lines.length; ++i) {
      jsonStr += lines[i] + "\n";
      let obj: unknown;
      try {
        obj = JSON.parse(jsonStr);
      } catch (_) {
        continue;
      }
      controller.enqueue(obj);
      jsonStr = "";
      nextIdx = i + 1;
    }
    if (nextIdx) {
      this.#buf = lines.slice(nextIdx).join("\n");
    }
  }
}
