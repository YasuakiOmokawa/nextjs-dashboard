export const uniqueCompanyId = (prefix: string) =>
  `cmp_${`${prefix}${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 24)}`;
