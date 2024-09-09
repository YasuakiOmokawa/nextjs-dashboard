/*
    How to use: Import the seedCreator.ts file and call the readAllTables function
    Ex: import model from './seedCreator';

    model.readAllTables({ allSeeds: true });
    model.readAllTables({ allSeeds: true, seedFile: true, logTables: false });
    Flag: allSeeds --> Create all seeds from all tables inside the ./prisma/seeds folder (create seeds folder if it doesn't exist)
    Flag: seedFile --> Create seed.ts file with all seeds imported
    Flag: logTables --> Log tables inside the console

    filters array: 
    [
      { keyToFilter: 'password', replaceTo: '01dfa4d90d9afbe', inTable: 'User' }, // Filter to not include in the seeds columns password and replaceTo = '01dfa4d90d9afbe' in the table User
      { keyToFilter: 'deletedAt' }, // Filter all keys deletedAt in all tables
      { keyToFilter: 'like', replaceTo: true, inTable: 'CommentAndLike' } // Filter all keys like in CommentAndLike table and replaceTo = true
    ] // This array is optional and you can add more filters

    Ex: model.readAllTables({ allSeeds: true, seedFile: true, logTables: false, arrFilters: filters });

    prisma[table].findMany({
        take: 1000,
      }); // Limit in 1000 rows

    After the seeds are created, you shuld run 'npx prisma db seed' (Ps: npx prisma migrate reset maybe dont make the seed all)
*/

import { Prisma } from "@prisma/client";
import { createSeedFile } from "./createSeedFile";
import { findAndRefind } from "./findAndRefind";
import { createAllSeeds } from "./createAllSeeds";

export interface IFilter<T> {
  keyToFilter: string;
  replaceTo?: string | boolean | Date | number | Array<T> | object | undefined;
  inTable?: string;
}

// Filter to not include in the seeds
const filters: IFilter<[]>[] = [
  {
    keyToFilter: "name",
    replaceTo: "hogehoge",
  },
  { keyToFilter: "email", inTable: "users" },
  // { keyToFilter: 'like', replaceTo: true, inTable: 'CommentAndLike' }
];

// Stack to try again -- Tables to re try the find All if some promisse is rejected.
const stackTryAgain: { [key: string]: number } = {};

export const readAllTables = async ({
  allSeeds = false,
  seedFile = false,
  logTables = true,
  arrFilters = filters,
  onlyTables = [] as Array<string>, // only especific tables
  folderName = "seeds",
} = {}) => {
  const tables =
    onlyTables.length > 0
      ? onlyTables
      : (Object.keys(Prisma.ModelName as Record<string, string>) as string[]);

  const merged = allSeeds ? await findAndRefind(tables, arrFilters) : {};

  const MAX_TRY_AGAIN = 3;
  let breakWhile = 10; // safe condition

  if (Object.keys(stackTryAgain).length > 0) {
    console.log(JSON.stringify(stackTryAgain, null, 2), "<--- stackTryAgain");
    console.log("\n **************** Go run while ************** \n");
    while (
      Object.keys(stackTryAgain).length > 0 &&
      Object.values(stackTryAgain).some((v) => v < MAX_TRY_AGAIN) &&
      breakWhile-- > 0
    ) {
      const newMerge = await findAndRefind(
        Object.keys(stackTryAgain) as string[],
        arrFilters
      );
      Object.assign(merged, newMerge);
    }
  }

  logTables && console.log("Start -->", merged, "<-- End");
  allSeeds && (await createAllSeeds(merged, folderName));
  seedFile && (await createSeedFile());
  console.log("Done ---");
  return { tables, collections: merged, stackTryAgain };
};
