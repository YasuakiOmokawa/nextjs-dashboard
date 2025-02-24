import type { Assert, Equals } from "./utility-types";

type _T01 = Assert<Equals<string, string>>;

type IsString<T> = T extends string ? true : false;

type _T02 = Assert<IsString<string>>;
