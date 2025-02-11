import { atomWithStorage } from "jotai/utils";

export const emailAtom = atomWithStorage<string>("emailAtom", "", undefined, {
  getOnInit: true,
});

export const nameAtom = atomWithStorage<string>("nameAtom", "", undefined, {
  getOnInit: true,
});

export const loginEmailAtom = atomWithStorage<string>(
  "loginEmailAtom",
  "",
  undefined,
  {
    getOnInit: true,
  }
);

export const loginPasswordAtom = atomWithStorage<string>(
  "loginPasswordAtom",
  "",
  undefined,
  {
    getOnInit: true,
  }
);
