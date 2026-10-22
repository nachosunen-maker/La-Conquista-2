/**
 * Rutas HTTP del despliegue. Convex Auth publica aquí la configuración OpenID y las claves
 * públicas (/.well-known/openid-configuration y /.well-known/jwks.json) con las que el
 * backend valida los tokens de sesión. Sin este archivo ningún inicio de sesión es válido.
 */
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

export default http;
