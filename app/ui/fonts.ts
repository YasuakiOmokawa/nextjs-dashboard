import { Inter } from "next/font/google";
import { Lusitana } from "next/font/google";
import { Bungee_Spice } from "next/font/google";

export const inter = Inter({ subsets: ["latin"] });

export const lusitana = Lusitana({
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const bungee_spice = Bungee_Spice({ subsets: ["latin"], weight: "400" });
