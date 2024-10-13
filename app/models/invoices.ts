import { PrismaClient } from "@prisma/client";

const ITEMS_PER_PAGE = 6;

type InvoicesTable = {
  id: string;
  customer_id: string;
  name: string;
  email: string;
  image_url: string;
  date: string;
  amount: number;
  status: "pending" | "paid";
};

type FilteredFetch = {
  query: string;
  currentPage: number;
};

export function Invoices(prismaInvoice: PrismaClient["invoices"]) {
  return Object.assign(prismaInvoice, {
    async filteredFetch(data: FilteredFetch): Promise<InvoicesTable[]> {
      const prisma = new PrismaClient();
      const offset = (data.currentPage - 1) * ITEMS_PER_PAGE;

      const invoices = await prisma.$queryRaw<InvoicesTable[]>`
        select
          invoices.id,
          invoices.amount,
          invoices.date,
          customers.name,
          customers.email,
          customers.image_url
        from
          invoices
        join customers on invoices.customer_id = customers.id
        where
          customers.name ILIKE concat('%', ${data.query}, '%')
          or customers.email ILIKE concat('%', ${data.query}, '%')
          or invoices.amount::text ILIKE concat('%', ${data.query}, '%')
          or invoices.date::text ILIKE concat('%', ${data.query}, '%')
          or invoices.status ILIKE concat('%', ${data.query}, '%')
        order by invoices.date desc
        limit ${ITEMS_PER_PAGE} offset ${offset}
      `;

      return invoices;
    },
    async fetchTotaltPages(
      data: Pick<FilteredFetch, "query">
    ): Promise<number> {
      const prisma = new PrismaClient();

      // NOTE: 生クエリのcount()はbigintを返却するのでintegerにキャスト
      // ref.https://github.com/prisma/prisma/issues/14613#issuecomment-1526258289
      const count = await prisma.$queryRaw<{ count: number }[]>`
        select
          count(1)::integer
        from
          invoices
        join customers on invoices.customer_id = customers.id
        where
          customers.name ILIKE concat('%', ${data.query}, '%')
          or customers.email ILIKE concat('%', ${data.query}, '%')
          or invoices.amount::text ILIKE concat('%', ${data.query}, '%')
          or invoices.date::text ILIKE concat('%', ${data.query}, '%')
          or invoices.status ILIKE concat('%', ${data.query}, '%')
      `;

      const countObject = count.at(0);
      const totalPages = Math.ceil(Number(countObject!.count / ITEMS_PER_PAGE));
      return totalPages;
    },
  });
}
