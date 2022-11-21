import type { Denops } from "https://deno.land/x/denops_std@v3.9.1/mod.ts";

export function printf(
  denops: Denops,
  format: string,
  arglist: unknown[],
): Promise<string[]> {
  return denops.eval(
    "map(l:arglist, { _, a -> printf(l:format, a) })",
    { format, arglist },
  ) as Promise<string[]>;
}

export function strlen(denops: Denops, slist: string[]): Promise<number[]> {
  return denops.eval(
    "map(l:slist, { _, s -> strlen(s) })",
    { slist },
  ) as Promise<number[]>;
}
