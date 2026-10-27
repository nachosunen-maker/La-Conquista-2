/**
 * Configuración de autenticación de Convex Auth (proveedor de contraseña, convex/auth.ts).
 * [DECISIÓN 21-10-2026] Sin inicio de sesión con Google: solo nombre de gobernante + contraseña.
 * El emisor de los tokens es el propio despliegue (CONVEX_SITE_URL la define Convex).
 * Los secretos de firma (JWT_PRIVATE_KEY, JWKS, SITE_URL) se configuran en el panel de Convex, nunca aquí.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL || "https://festive-dodo-429.eu-west-1.convex.site",
      applicationID: "convex",
    },
  ],
};
