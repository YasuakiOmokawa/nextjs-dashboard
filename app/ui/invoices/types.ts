// detect form element by id property
interface FormElements extends HTMLFormControlsCollection {
  customer: HTMLSelectElement;
  amount: HTMLInputElement;
  status: HTMLInputElement;
}

export interface CreationFormElement extends HTMLFormElement {
  readonly elements: FormElements;
}
