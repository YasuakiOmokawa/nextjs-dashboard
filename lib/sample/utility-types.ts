export type Assert<T extends true> = T;

export type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <
  U
>() => U extends Y ? 1 : 2
  ? true
  : false;
