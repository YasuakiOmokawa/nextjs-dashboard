import { Prisma } from "@prisma/client";
import fs from "fs/promises";

// Ex: User -> user | CommentAndLike -> commentAndLike
const snakeToCamel = (str: string) =>
  str.toLocaleLowerCase().replace(/([-_][a-z])/g, (undeScoreAndString) => {
    return undeScoreAndString.toUpperCase().replace("-", "").replace("_", "");
  });

const writeTable = async (
  table: string,
  value: Array<Prisma.ModelName>,
  folder: string
) => {
  const tableNameCamelCase = snakeToCamel(table);
  const dir = `./prisma/${folder}`;
  await fs.mkdir(dir, { recursive: true });
  return fs.writeFile(
    `${dir}/${tableNameCamelCase}.json`,
    `${JSON.stringify(value, null, 2)}`
  );
};

export const createAllSeeds = async (
  tables: { [key: string]: [] },
  folder: string
) => {
  await Promise.allSettled(
    Object.keys(tables).map((key) => {
      writeTable(key, tables[key], folder);
    })
  );
};
