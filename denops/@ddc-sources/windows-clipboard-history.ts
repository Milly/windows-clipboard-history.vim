import type { SetRequired } from "https://cdn.skypack.dev/type-fest@3.2.0?dts";
import type {
  GatherArguments,
  OnCompleteDoneArguments,
  OnInitArguments,
} from "https://deno.land/x/ddc_vim@v3.1.0/base/source.ts";
import { BaseSource } from "https://deno.land/x/ddc_vim@v3.1.0/types.ts";
import type {
  Item as DdcItem,
  PumHighlight,
} from "https://deno.land/x/ddc_vim@v3.1.0/types.ts";
import { strlen } from "https://deno.land/x/denops_std@v3.9.1/function/mod.ts";
import type { Denops } from "https://deno.land/x/denops_std@v3.9.1/mod.ts";
import { globalOptions } from "https://deno.land/x/denops_std@v3.9.1/variable/option.ts";
import * as bulk from "../windows-clipboard-history/bulk.ts";
import {
  ClipboardHistory,
  ClipboardHistoryItem,
} from "../windows-clipboard-history/clipboard-history.ts";
import { toDuration } from "../windows-clipboard-history/time.ts";

type Params = {
  /** PowerShell executable path. (default: "powershell.exe") */
  pwsh: string;
  /** Cache expires interval. (default: 3000 [msec]) */
  cacheExpires: number;
  /** Max width of the abbreviates column. (default: 0)
   *
   * If 0 is specified, be unlimited.
   */
  maxAbbrWidth: number;
  /** Highlight group name for unprintable chars. (default: "SpecialKey")
   *
   * If empty, highlight is disabled.
   */
  ctrlCharHlGroup: string;
};

type OperatorWise = "c" | "l" | "b" | "";

type UserData = {
  text: string;
  word: string;
  suffix: string;
};

type Item = SetRequired<DdcItem<UserData>, "abbr" | "user_data">;

const ID = "ddc/source/windows-clipboard-history";

// deno-fmt-ignore
const UNPRINTABLE_CHARS = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
  0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
  0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
] as const;
const UNPRINTABLE_CHAR_LENGTH = 2; // "^@".length
const UNPRINTABLE_BYTE_LENGTH = 2; // strlen("^@")

export class Source extends BaseSource<Params, UserData> {
  #clipboardHistory: ClipboardHistory | undefined;
  // deno-lint-ignore no-control-regex
  #reUnprintableChar = /[\x00-\x1f]/g;

  override params(): Params {
    return {
      pwsh: "powershell.exe",
      cacheExpires: 3000,
      maxAbbrWidth: 0,
      ctrlCharHlGroup: "SpecialKey",
    };
  }

  override async onInit(args: OnInitArguments<Params>): Promise<void> {
    const { denops, sourceParams: { pwsh, cacheExpires } } = args;
    this.#clipboardHistory = new ClipboardHistory({ pwsh, cacheExpires });
    this.#reUnprintableChar = await this.#getUnprintableRegExp(denops);
    await this.#clipboardHistory.waitInitialized();
  }

  override async gather(
    args: GatherArguments<Params>,
  ): Promise<DdcItem<UserData>[]> {
    if (!this.#clipboardHistory) {
      throw new Error("Object not initialized");
    }
    const {
      denops,
      context: { nextInput },
      sourceParams: { maxAbbrWidth, ctrlCharHlGroup },
      sourceOptions: { maxItems },
    } = args;

    const [abbrWidth, recentHistory] = await Promise.all([
      this.#getAbbrWidth(denops, maxAbbrWidth),
      this.#clipboardHistory.getHistory().then((history) =>
        history.slice(0, Math.max(1, maxItems))
      ),
    ]);

    const items = this.#generateItems(recentHistory, nextInput);
    await this.#applyAbbrWidth(denops, items, abbrWidth);

    if (ctrlCharHlGroup) {
      await this.#applyHighlights(denops, items, ctrlCharHlGroup);
    }

    return items;
  }

  override async onCompleteDone(
    args: OnCompleteDoneArguments<Params, UserData>,
  ): Promise<void> {
    const {
      denops,
      context: { input, nextInput, lineNr },
      userData: { text, word, suffix },
    } = args;
    const line = input + nextInput;
    const isConfirmed = line.endsWith(word + suffix);
    const hasUnprintable = this.#reUnprintableChar.test(text);

    if (isConfirmed && hasUnprintable) {
      const prefix = line.slice(0, line.length - word.length - suffix.length);
      const newText = prefix + text + suffix;
      const cursorCol = newText.length - nextInput.length;
      const prevText = newText.slice(0, cursorCol);
      const nextText = newText.slice(cursorCol);
      const lines = textToRegContents(prevText + nextText);

      const prevLines = prevText.split("\n");
      const newLnum = lineNr + prevLines.length - 1;
      const newCol = await strlen(denops, prevLines.at(-1)) as number + 1;
      const newCursorPos = [0, newLnum, newCol, 0];

      await denops.call(
        "windows_clipboard_history#ddc#_insert",
        lineNr,
        lines,
        newCursorPos,
      );
    }
  }

  async #getUnprintableRegExp(denops: Denops): Promise<RegExp> {
    // generate RegExp e.g.: /[\x00-\x1f\x7f-\x9f]/g
    const unprintable = new Set([
      ...UNPRINTABLE_CHARS,
      ...(await getUnprintableChars(denops)),
    ]);
    const lastGuard = 0x100;
    unprintable.delete(lastGuard);
    const xhh = (n: number) => "\\x" + `0${n.toString(16)}`.slice(-2);
    const range: string[] = [];
    for (let start = -1, code = 0; code <= lastGuard; ++code) {
      if (start < 0 && unprintable.has(code)) {
        start = code;
      } else if (start >= 0 && !unprintable.has(code)) {
        const end = code - 1;
        range.push(start === end ? xhh(start) : xhh(start) + "-" + xhh(end));
        start = -1;
      }
    }
    return new RegExp(`[${range.join("")}]`, "g");
  }

  async #getAbbrWidth(denops: Denops, maxAbbrWidth: number): Promise<number> {
    const vimColumns = await globalOptions.get(denops, "columns", 9999);
    return maxAbbrWidth > 0 ? Math.min(maxAbbrWidth, vimColumns) : vimColumns;
  }

  #generateItems(history: ClipboardHistoryItem[], suffix: string): Item[] {
    const now = Date.now();
    return history.map((hist): Item => {
      const text = hist.Text.replaceAll("\r\n", "\n");
      const wise: OperatorWise = text.endsWith("\n") ? "l" : "c";
      const word = text.replaceAll(this.#reUnprintableChar, "?");
      const abbr = text.replaceAll(
        this.#reUnprintableChar,
        unpritableCharConverter,
      );
      const duration = toDuration(now - hist.Time);
      return {
        word,
        abbr,
        info: text,
        kind: wise,
        menu: duration,
        user_data: {
          text,
          word,
          suffix,
        },
      };
    });
  }

  async #applyAbbrWidth(
    denops: Denops,
    items: Item[],
    abbrWidth: number,
  ): Promise<void> {
    const truncated = await bulk.printf(
      denops,
      `%.${abbrWidth}S`,
      items.map(({ abbr }) => abbr),
    );
    items.forEach((item, i) => {
      item.abbr = truncated[i];
    });
  }

  async #applyHighlights(
    denops: Denops,
    items: Item[],
    hlGroup: string,
  ): Promise<void> {
    const itemSlices = items.map((item) => {
      const { abbr, user_data } = item;
      const text = user_data.text.slice(0, abbr.length);
      const slices = text.split(this.#reUnprintableChar).slice(0, -1);
      return { item, slices };
    });
    const sliceBytes = await bulk.strlen(
      denops,
      itemSlices.map(({ slices }) => slices).flat(),
    );
    let sliceBytesIndex = 0;
    const itemSliceBytes = itemSlices.map(({ item, slices }) => ({
      item,
      slices: slices.map((slice) => ({
        chars: slice.length,
        bytes: sliceBytes[sliceBytesIndex++],
      })),
    }));

    for (const { item, slices } of itemSliceBytes) {
      if (slices.length > 0) {
        item.highlights = this.#generateHighlights(item.abbr, slices, hlGroup);
      }
    }
  }

  #generateHighlights(
    abbr: string,
    abbrSlices: { chars: number; bytes: number }[],
    hlGroup: string,
  ): PumHighlight[] {
    const highlights: PumHighlight[] = [];
    let lastHighlight: PumHighlight | undefined;
    let len = 0; // [chars]
    let col = 0; // [bytes]

    for (const { chars, bytes } of abbrSlices) {
      if (bytes === 0 && lastHighlight) {
        // increase width
        lastHighlight.width += UNPRINTABLE_BYTE_LENGTH;
      } else {
        len += chars;
        col += bytes;
        if (len >= abbr.length) {
          break;
        }

        // add new highlight
        lastHighlight = {
          name: `${ID}/unprintable`,
          type: "abbr",
          hl_group: hlGroup,
          col,
          width: UNPRINTABLE_BYTE_LENGTH,
        };
        highlights.push(lastHighlight);
      }

      len += UNPRINTABLE_CHAR_LENGTH;
      col += UNPRINTABLE_BYTE_LENGTH;
      if (len >= abbr.length) {
        lastHighlight.width -= len - abbr.length;
        break;
      }
    }

    return highlights;
  }
}

function textToRegContents(text: string): string[] {
  return text.split("\n").map((s) => s.replaceAll("\x00", "\n"));
}

function unpritableCharConverter(c: string): string {
  const code = c.charCodeAt(0);
  if (code <= 0x1f) return "^" + String.fromCharCode(code + 0x40);
  if (code === 0x7f) return "^?";
  if (code <= 0x9f) return "~" + String.fromCharCode(code - 0x40);
  if (code <= 0xfe) return "|" + String.fromCharCode(code - 0x80);
  return "~?";
}

function getUnprintableChars(
  denops: Denops,
): Promise<number[]> {
  return denops.eval(
    "range(0x100)->filter({ _, n -> nr2char(n) !~# '\\p' })",
  ) as Promise<number[]>;
}
