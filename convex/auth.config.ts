/**
 * Configuración de autenticación de Convex Auth (proveedor de contraseña, convex/auth.ts).
 * [DECISIÓN 21-10-2026] Sin inicio de sesión con Google: solo nombre de gobernante + contraseña.
 * Los secretos de firma (JWT_PRIVATE_KEY, JWKS, SITE_URL) se configuran en el panel de Convex, nunca aquí.
 */
export default {
  providers: [
    {
      domain: "CONVEX_AUTH",
      applicationID: "convex",
    },
  ],
};
