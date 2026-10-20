/**
 * Configuración de autenticación OpenID Connect (OIDC) para Convex
 * Valida los tokens JWT emitidos por Google Identity Services
 */
export default {
  providers: [
    {
      domain: "CONVEX_AUTH",
      applicationID: "convex",
    },
  ],
};
