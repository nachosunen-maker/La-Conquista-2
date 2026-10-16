/**
 * Configuración de autenticación OpenID Connect (OIDC) para Convex
 * Valida los tokens JWT emitidos por Google Identity Services
 */
export default {
  providers: [
    {
      domain: "https://accounts.google.com",
      applicationID: "198291664207-573hkldm168ltr0h5rscs0k8iooilqul.apps.googleusercontent.com",
    },
  ],
};
