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

type Entry = {
  id: number;
  title: string;
};

type _T15 = Assert<Equals<Entry["id"], number>>;
type IdAndName = [number, string];

type _T16 = Assert<Equals<IdAndName["0"], number>>;
type _T17 = Assert<Equals<IdAndName[number], number | string>>;

type ObjectAndIndex = {
  [key: number]: string;
};
type _T18 = Assert<Equals<ObjectAndIndex[number], string>>;

type ArrayElement<T> = T extends Array<infer U> ? U : never;
type _T19 = Assert<Equals<ArrayElement<Array<number>>, number>>;
type _T20 = Assert<Equals<ArrayElement<[number, string]>, number | string>>;

type T21 = { a: string; b: string };
type T22 = { b: string; c: string };
type KI = keyof T21 & keyof T22;
type _T21 = Assert<Equals<KI, "b">>;
type KU = keyof (T21 | T22);
type _T22 = Assert<Equals<KU, "b">>;
type ValueTypeOf<T, K extends keyof T> = T[K];
type _ValueUnion = ValueTypeOf<T21 | T22, "b">;

type KI2 = keyof (T21 & T22);
type KU2 = keyof T21 | keyof T22;
type _T23 = Assert<Equals<KI2, KU2>>;
