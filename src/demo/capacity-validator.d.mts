import type { PreparedCapacity } from "./capacity-evaluation";

declare const validate: {
  (value: unknown): value is PreparedCapacity;
  errors?: { instancePath: string; message?: string }[] | null;
};
export default validate;
