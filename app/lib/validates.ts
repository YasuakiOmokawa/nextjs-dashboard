import { z } from "zod";

const InvoiceFormSchema = z.object({
  id: z.string(),
  date: z.date(),
  customerId: z.string({
    invalid_type_error: "Please select a customer.",
    required_error: "Customer is required.",
  }),
  amount: z.coerce.number().gt(0, "Please enter an amount greater than $0."),
  status: z.enum(["paid", "pending"], {
    invalid_type_error: "Please select an invoice status.",
    required_error: "Invoice status is required.",
  }),
});

const CreateInvoiceForm = InvoiceFormSchema.omit({ id: true, date: true });

export const validatesCreateInvoice = (data: {
  [key: string]: FormDataEntryValue;
}) => CreateInvoiceForm.safeParse(data);

const UpdateInvoiceForm = InvoiceFormSchema.omit({ id: true, date: true });

export const validatesUpdateInvoice = (data: {
  [key: string]: FormDataEntryValue;
}) => UpdateInvoiceForm.safeParse(data);
