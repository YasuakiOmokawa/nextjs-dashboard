import type { TeamPage } from "../api";

export type Level = TeamPage["team"]["levels"][number]["level"];

export const levels: Record<Level, { symbol: string; label: string }> = {
  0: { symbol: "", label: "未経験" },
  1: { symbol: "△", label: "支援があればできる" },
  2: { symbol: "○", label: "一人でできる" },
  3: { symbol: "◎", label: "教えられる" },
};
