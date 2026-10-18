/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "./schema";

/** Módulos de Convex para el backend simulado de convex-test. */
export const modules = import.meta.glob("./**/*.ts");

export function createTestBackend() {
  return convexTest(schema, modules);
}
