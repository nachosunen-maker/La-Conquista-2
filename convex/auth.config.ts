/**
 * Configuración de autenticación de Convex Auth (convex/auth.ts).
 * El emisor OIDC en el deployment festive-dodo-429 es https://festive-dodo-429.eu-west-1.convex.site.
 */
export default {
  providers: [
    {
      domain: "https://festive-dodo-429.eu-west-1.convex.site",
      applicationID: "convex",
    },
  ],
};
