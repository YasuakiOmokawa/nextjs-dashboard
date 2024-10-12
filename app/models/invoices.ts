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

      const count: number = await prisma.$queryRaw`
        select
          count(1)
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

      const totalPages = Math.ceil(Number(count / ITEMS_PER_PAGE));
      return totalPages;
    },
  });
}
