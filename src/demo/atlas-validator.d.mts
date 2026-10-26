import type { PreparedAtlas } from "./atlas-evaluation";

declare const validate: {
  (value: unknown): value is PreparedAtlas;
  errors?: { instancePath: string; message?: string }[] | null;
};
export default validate;
