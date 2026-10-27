import type { PreparedTowWindows } from "./tow-windows-evaluation";
declare function validate(value: unknown): value is PreparedTowWindows;
declare namespace validate { let errors: { instancePath: string; message?: string }[] | null; }
export default validate;
