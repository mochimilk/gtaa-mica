import type { PreparedAccommodation } from "./accommodation-evaluation";

declare const validate: {
  (value: unknown): value is PreparedAccommodation;
  errors?: { instancePath: string; message?: string }[] | null;
};
export default validate;
