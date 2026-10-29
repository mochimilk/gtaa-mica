import type { PreparedTowWindows } from "./towWindows";
declare const validate: {
  (value: unknown): value is PreparedTowWindows;
  errors?: { instancePath: string; message?: string }[] | null;
};
export default validate;
