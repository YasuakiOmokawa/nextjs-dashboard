import { Prisma, PrismaClient } from "@prisma/client";
import fs from "fs/promises";

const prisma = new PrismaClient();

async function main() {
  let tablesTryAgain: any[] = [];
  const tables = Object.keys(Prisma.ModelName);
  let limit = 10;
  const MAX = limit;

  const snakeToCamel = (str: string) =>
    str.toLocaleLowerCase().replace(/([-_][a-z0-9])/g, (undeScoreAndString) => {
      return undeScoreAndString.toUpperCase().replace("-", "").replace("_", "");
    });

  const readFile = async (path: string) => {
    try {
      const data = await fs.readFile(`./prisma/seeds/${path}`, "utf8");
      const dataParse = JSON.parse(data);
      if (Array.isArray(dataParse)) return dataParse;
    } catch (error: any) {
      console.log(error.message, "<---XXX");
    }
    return [];
  };

  const getModel = (modelName: string) => {
    for (const [key, value] of Object.entries(prisma)) {
      if (typeof value == "object" && key == modelName) {
        return value;
      }
    }
  };

  const seedTable = async (table: Prisma.ModelName) => {
    const data = await readFile(`${snakeToCamel(table)}.json`);

    try {
      tablesTryAgain = tablesTryAgain.filter((t) => t !== table);
      await getModel(table).createMany({ data });
    } catch (error: any) {
      if (!error.message.toLowerCase().includes("unique constraint")) {
        console.log(
          "\n XXXXXXXXX ",
          error.message,
          "\n",
          table,
          "<---Adding in try Again XXXXX"
        );
        tablesTryAgain.push(table);
      }
    }
  };

  const dropAll = async (arrTables = tables) => {
    for (let i = 0; i < arrTables.length; i++) {
      const table = arrTables[i];
      try {
        tablesTryAgain = tablesTryAgain.filter((t) => t !== table);
        await getModel(table).deleteMany({});
      } catch (error: any) {
        tablesTryAgain.push(table);
        console.log(
          "\n XXXXXXXXX ",
          "\n",
          table,
          "<--- FAIL TO DROPED XXXXX",
          tablesTryAgain,
          "\n"
        );
      }
    }
  };
  const seedAll = async () => {
    for (let i = 0; i < tables.length; i++) {
      await seedTable(tables[i] as Prisma.ModelName);
    }
  };
  console.clear();

  const isDroped = false;
  const action = isDroped ? dropAll : seedAll;

  await action();

  if (tablesTryAgain.length > 0) {
    while (tablesTryAgain.length > 0 && limit-- > 0) {
      await action(tablesTryAgain);
    }
  }

  console.log(
    "The end",
    tablesTryAgain,
    "<-- Tables to seed (Fails) | Number of trys: ",
    MAX - limit
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
