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

type ToArray<T> = T extends unknown ? Array<T> : never;
type ToArrayND<T> = [T] extends [unknown] ? Array<T> : never;
type R11 = ToArray<string | number>;
type _T12 = Assert<Equals<R11, Array<string> | Array<number>>>;
type R12 = ToArrayND<string | number>;
type _T13 = Assert<Equals<R12, Array<string | number>>>;

type R13 = string | number extends unknown ? Array<string | number> : never;
type _T14 = Assert<Equals<R13, Array<string | number>>>;
