import type { PhotoType } from "@/types/domain";

const labels: Record<PhotoType, string> = {
  antes: "1er control",
  durante: "2do control",
  despues: "3er control",
};

export function photoTypeLabel(value: string) {
  return labels[value as PhotoType] ?? value;
}
