import type {
  GatherArguments,
  OnInitArguments,
} from "https://deno.land/x/ddu_vim@v1.13.0/base/source.ts";
import { BaseSource } from "https://deno.land/x/ddu_vim@v1.13.0/types.ts";
import type { Item as DduItem } from "https://deno.land/x/ddu_vim@v1.13.0/types.ts";
import { strlen } from "https://deno.land/x/denops_std@v3.9.1/function/mod.ts";
import {
  ClipboardHistory,
  ClipboardHistoryItem,
} from "../windows-clipboard-history/clipboard-history.ts";
import { toDuration } from "../windows-clipboard-history/time.ts";
import { abortable } from "https://deno.land/std@0.160.0/async/abortable.ts";

type Params = {
  /** PowerShell executable path. (default: "powershell.exe") */
  pwsh: string;
  /** Cache expires interval. (default: 3000 [msec]) */
  cacheExpires: number;
  /** Highlight group name for header. (default: "Special")
   *
   * If empty, highlight is disabled.
   */
  headerHlGroup: string;
  /** Prefix for displayed items. (default: "") */
  prefix: string;
};

type ActionData = {
  text: string;
  regType: "V" | "v";
};

type Item = DduItem<ActionData>;

export class Source extends BaseSource<Params, ActionData> {
  kind = "word";
  #clipboardHistory: ClipboardHistory | undefined;

  override params(): Params {
    return {
      pwsh: "powershell.exe",
      cacheExpires: 3000,
      headerHlGroup: "Special",
      prefix: "",
    };
  }

  override async onInit(args: OnInitArguments<Params>): Promise<void> {
    const { sourceParams: { pwsh, cacheExpires } } = args;
    this.#clipboardHistory = new ClipboardHistory({ pwsh, cacheExpires });
    await this.#clipboardHistory.waitInitialized();
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
