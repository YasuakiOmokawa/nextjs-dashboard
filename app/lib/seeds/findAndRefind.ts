import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface IFilter<T> {
  keyToFilter: string;
  replaceTo?: string | boolean | Date | number | Array<T> | object | undefined;
  inTable?: string;
}

type ObjectWithStringKey = {
  [k in string]: unknown;
};

// Stack to try again -- Tables to re try the find All if some promisse is rejected.
const stackTryAgain: { [key: string]: number } = {};

const getModel = (modelName: string) => {
  for (const [key, value] of Object.entries(prisma)) {
    if (typeof value == "object" && key == modelName) {
      return value;
    }
  }
};

function assertObjectWithStringKey(
  obj: object
): asserts obj is ObjectWithStringKey {
  if (Object.keys(obj).some((element) => typeof element !== "string")) {
    throw new Error("object key must be string!");
  }
}

const filteredFields = (
  obj: object,
  filter: IFilter<[]>
): ObjectWithStringKey => {
  assertObjectWithStringKey(obj);
  const { keyToFilter, replaceTo } = filter;
  return Object.keys(obj).reduce((acc, key) => {
    assertObjectWithStringKey(acc);
    if (key === keyToFilter) {
      if (replaceTo === undefined) {
        return acc;
      }
      acc[key] = replaceTo;
      return acc;
    }
    acc[key] = obj[key];
    return acc;
  }, {});
};

const filterTables = (obj: object, filters: IFilter<[]>[], key: string) => {
  return filters.reduce((acc, filter) => {
    if (filter.inTable && filter.inTable !== key) {
      return acc;
    }
    return filteredFields(acc, filter);
  }, obj) as object;
};

const removeNullElements = (obj: object) => {
  return Object.keys(obj).reduce((acc, key) => {
    if (obj[key as keyof object] === null) {
      return acc;
    }
    acc[key as keyof object] = obj[key as keyof object];
    return acc;
  }, {} as object);
};

export const findAndRefind = async (
  tables: string[],
  internalFilters: IFilter<[]>[]
) => {
  const selectsAll = await Promise.allSettled(
    tables.map((table) => {
      return getModel(table).findMany({
        take: 1000,
      });
    })
  );

  const merged = selectsAll.reduce((acc, result, i) => {
    if (result.status !== "fulfilled") {
      console.log("Error", result.reason, "<---Try Again XXXXX");
      stackTryAgain[tables[i]] = (stackTryAgain[tables[i]] || 0) + 1;
      return acc;
    }

    delete stackTryAgain[tables[i]];
    acc[tables[i]] = result.value.map((item: object) =>
      filterTables(
        removeNullElements(item),
        internalFilters,
        tables[i] as string
      )
    );
    return acc;
  }, {} as { [key: string]: [] });

  return merged;
};
