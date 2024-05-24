import * as path from "https://deno.land/std@0.224.0/path/mod.ts";
import { JSONDecodeStream } from "./json.ts";

const __dirname = path.dirname(path.fromFileUrl(import.meta.url));

const DEFAULT_PWSH_EXECUTABLE = "powershell.exe";
const DEFAULT_CACHE_EXPIRES = 3000;
const PS_MODULE_PATHS = [
  path.join(__dirname, "clipboard-history.psm1"),
  path.join(__dirname, "safe-json.psm1"),
];
const CLIPBOARD_HISTORY_COMMAND =
  "ConvertTo-SafeEncodeJson @(Get-ClipboardHistory) -Compress";

export type ClipboardHistoryOptions = {
  /** PowerShell executable path. (default: "powershell.exe") */
  pwsh?: string;
  /** Cache expires interval. (default: 3000 [msec]) */
  cacheExpires?: number;
  /** Signal for dispose object. */
  signal?: AbortSignal;
};

export type ClipboardHistoryItem = {
  Id: string;
  Text: string;
  Time: number;
};

type HistoryCache = {
  updated: number;
  history: ClipboardHistoryItem[];
};

type Runner = {
  getHistory(): Promise<HistoryCache>;
  cache: HistoryCache;
};

export class ClipboardHistory implements AsyncDisposable {
  #aborter = new AbortController();
  #opts: Required<ClipboardHistoryOptions>;
  #runner: Promise<Runner>;
  #getter?: Promise<HistoryCache>;

  constructor(opts: ClipboardHistoryOptions = {}) {
    const {
      pwsh = DEFAULT_PWSH_EXECUTABLE,
      cacheExpires = DEFAULT_CACHE_EXPIRES,
    } = opts;
    const { signal } = this.#aborter;
    this.#opts = {
      pwsh,
      cacheExpires,
      signal: opts.signal ? AbortSignal.any([signal, opts.signal]) : signal,
    };
    this.#runner = this.#initRunner();
    this.#runner.catch(() => {
      // Prevent unhandled rejection.
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.#opts.signal.aborted) {
      this.#aborter.abort(new TypeError("ClipboardHistory disposed"));
    }
    try {
      await this.#runner;
    } catch (e) {
      if (e !== this.#opts.signal) {
        throw e;
      }
    }
  }

  async getHistory(): Promise<ClipboardHistoryItem[]> {
    const runner = await this.#runner;
    const age = Date.now() - runner.cache.updated;
    if (age >= this.#opts.cacheExpires) {
      this.#getter ??= runner.getHistory();
      runner.cache = await this.#getter;
      this.#getter = undefined;
    }
    return runner.cache.history.map((h) => ({ ...h })); // deep cloned
  }

  async #initRunner(): Promise<Runner> {
    const { pwsh, signal } = this.#opts;

    const psCommand = [
      `Import-Module @(${
        PS_MODULE_PATHS.map((path) => `"${path}"`).join(", ")
      })`,
      `while ((Read-Host) -eq '') { ${CLIPBOARD_HISTORY_COMMAND} }`,
    ].join(";");
    const command = new Deno.Command(pwsh, {
      args: ["-NoProfile", "-Command", psCommand],
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
      signal,
    });
    const child = command.spawn();

    const reader = child.stdout
      .pipeThrough(new TextDecoderStream(), { signal })
      .pipeThrough(new JSONDecodeStream())
      .getReader();

    const writeStream = new TextEncoderStream();
    writeStream.readable.pipeTo(child.stdin, { signal });
    const writer = writeStream.writable.getWriter();

    const getHistory = async (): Promise<HistoryCache> => {
      const [, history] = await Promise.all([
        this.#writeCommand(writer, "\n"),
        this.#readResult(reader),
      ]);
      return { history, updated: Date.now() };
    };

    // wait initial data
    try {
      const cache = await getHistory();
      return { getHistory, cache };
    } catch (e) {
      this.#aborter.abort(e);
      throw e;
    }
  }

  async #writeCommand(
    writer: WritableStreamDefaultWriter<string>,
    command: string,
  ): Promise<void> {
    await writer.ready;
    await writer.write(command);
  }

  async #readResult(
    reader: ReadableStreamDefaultReader<unknown>,
  ): Promise<ClipboardHistoryItem[]> {
    const { done, value } = await reader.read();
    if (done) {
      throw new TypeError("Unexpected stream EOF");
    }
    if (!Array.isArray(value)) {
      throw new TypeError(`Invalid result: ${value}`);
    }
    return value;
  }
}
