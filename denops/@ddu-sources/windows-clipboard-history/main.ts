import { abortable } from "@std/async/abortable";
import {
  BaseSource,
  type GatherArguments,
  type OnInitArguments,
} from "@shougo/ddu-vim/source";
import type { Item as DduItem } from "@shougo/ddu-vim/types";
import { strlen } from "@denops/std/function";
import {
  ClipboardHistory,
  type ClipboardHistoryItem,
} from "@milly/windows-clipboard-history/clipboard-history";
import { toDuration } from "@milly/windows-clipboard-history/time";
import type { Params } from "./params.ts";

type ActionData = {
  text: string;
  regType: "V" | "v";
};

type Item = DduItem<ActionData>;

export class Source extends BaseSource<Params, ActionData> {
  override kind = "word";
  #clipboardHistory?: ClipboardHistory;

  override params(): Params {
    return {
      pwsh: "powershell.exe",
      cacheExpires: 3000,
      headerHlGroup: "Special",
      prefix: "",
    };
  }

  // deno-lint-ignore require-await
  override async onInit(args: OnInitArguments<Params>): Promise<void> {
    const { sourceParams: { pwsh, cacheExpires } } = args;
    this.#clipboardHistory = new ClipboardHistory({ pwsh, cacheExpires });
  }

  override gather(
    args: GatherArguments<Params>,
  ): ReadableStream<Item[]> {
    const abortController = new AbortController();
    const { signal } = abortController;
    return new ReadableStream({
      start: (controller) => this.#startGatherStream(controller, args, signal),
      cancel: (reason) => abortController.abort(reason),
    });
  }

  async #startGatherStream(
    controller: ReadableStreamDefaultController<Item[]>,
    args: GatherArguments<Params>,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.#clipboardHistory) {
      throw new Error("Object not initialized");
    }
    const {
      denops,
      sourceParams: { prefix, headerHlGroup },
      sourceOptions: { maxItems },
    } = args;

    const gather = async () => {
      const [prefixWidth, recentHistory] = await Promise.all([
        strlen(denops, prefix) as Promise<number>,
        this.#clipboardHistory!.getHistory().then(
          (history) => history.slice(0, Math.max(1, maxItems)),
        ),
      ]);

      if (signal.aborted) return;

      const items = this.#generateItems(
        recentHistory,
        prefixWidth,
        prefix,
        headerHlGroup,
      );

      controller.enqueue(items);
    };

    try {
      await abortable(gather(), signal);
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        console.error(e);
      }
    } finally {
      controller.close();
    }
  }

  #generateItems(
    history: ClipboardHistoryItem[],
    prefixWidth: number,
    prefix: string,
    headerHlGroup: string,
  ): Item[] {
    const now = Date.now();
    const headerHlName = `source/${this.name}/header`;
    return history.map((item, index): Item => {
      const text = item.Text.replaceAll("\r\n", "\n");
      const duration = toDuration(now - item.Time);
      const header = `${zeroPad(index, 2)}:${zeroPad(duration, 3)}:`;
      this.name;
      return {
        word: `${prefix}${header} ${text}`,
        action: {
          text,
          regType: text.endsWith("\n") ? "V" : "v",
        },
        highlights: [
          {
            name: headerHlName,
            hl_group: headerHlGroup,
            col: 1,
            width: prefixWidth + header.length,
          },
        ],
      };
    });
  }
}

function zeroPad(s: unknown, len: number): string {
  return `${s}`.padStart(len, "0");
}
