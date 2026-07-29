import type { Locale } from "../types";
import { zhTW } from "./zh-TW";

type DeepStrings<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]>;
};

export type TranslationSchema = DeepStrings<typeof zhTW>;
export { zhTW };
export { en } from "./en";

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "zh-TW" || value === "en";
}
