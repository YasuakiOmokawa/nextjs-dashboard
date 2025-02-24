import type { Assert, Equals } from "./utility-types";

type _T01 = Assert<Equals<string, string>>;

type IsString<T> = T extends string ? true : false;

type _T02 = Assert<IsString<string>>;

type R1 = IsString<string | number>;
type _T03 = Assert<Equals<R1, boolean>>;

type _R2 = IsString<string> | IsString<number>;

type _R3 =
  | (string extends string ? true : false)
  | (number extends string ? true : false);
