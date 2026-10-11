type SendErrorReport = (error: unknown) => void;

let send: SendErrorReport = () => {};

export const sendErrorReportsTo = (next: SendErrorReport) => {
  send = next;
};

export const reportError = (error: unknown) => {
  console.error(error);
  try {
    send(error);
  } catch (sendFailure) {
    console.error(sendFailure);
  }
};
