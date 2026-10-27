/**
 * Configuración de autenticación de Convex Auth (proveedor de contraseña, convex/auth.ts).
 * [DECISIÓN 21-10-2026] Sin inicio de sesión con Google: solo nombre de gobernante + contraseña.
 * El emisor de los tokens es el propio despliegue (CONVEX_SITE_URL la define Convex).
 */
export default {
  providers: [
    {
      domain: "https://festive-dodo-429.eu-west-1.convex.site",
      applicationID: "convex",
    },
  ],
};
