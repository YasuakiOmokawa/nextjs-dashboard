import { chain } from "./middlewares/chain";
import { redirectHoge } from "./middlewares/redirectHoge";

export default chain([redirectHoge]);
