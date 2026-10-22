import type { PreparedScenario } from "./dataset";

declare const validate: {
  (value: unknown): value is PreparedScenario;
  errors?: { instancePath: string; message?: string }[] | null;
};
export default validate;
