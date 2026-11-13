import type { PreparedAtlas } from "./atlas";
declare const validate: {
  (value: unknown): value is PreparedAtlas;
  errors?: { instancePath: string; message?: string }[] | null;
};
export default validate;
