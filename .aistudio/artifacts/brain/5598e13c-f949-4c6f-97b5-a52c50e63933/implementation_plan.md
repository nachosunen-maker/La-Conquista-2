# Plan de Implementación: Despliegue Controlado del Esquema Militar a Convex

## Resumen de la Acción y Aclaraciones
En respuesta a las decisiones confirmadas por el usuario:
- **Acción principal**: Ejecutar el despliegue del esquema y funciones actuales al entorno remoto de Convex mediante `npx convex deploy`.
- **Alcance de archivos**: Mantener el código actual del proyecto sin extraer ni sustituir archivos por el paquete `La-Conquista-2-main` adjunto, siguiendo estrictamente el desarrollo secuencial y la protección de datos preexistentes.
- **Protección de Iberia**: Cero modificaciones destructivas sobre el reino de demostración Iberia.

---

## Arquitectura y Estado de Datos

El despliegue sincroniza la infraestructura del **Bloque Militar 2C** hacia el servidor remoto de Convex:

```
┌────────────────────────────────────────────────────────┐
│                    CONVEX BACKEND                      │
│                                                        │
│  ┌──────────────────┐          ┌───────────────────┐  │
│  │    kingdoms      │          │     armyUnits     │  │
│  │ (regularSoldiers)│◄────────►│   (by_kingdom)    │  │
│  └─────────┬────────┘          └───────────────────┘  │
│            │                                           │
│            ▼                                           │
│  ┌──────────────────┐          ┌───────────────────┐  │
│  │constructionQueue │          │   trainingQueue   │  │
│  │   (by_kingdom)   │          │   (by_kingdom)    │  │
│  └──────────────────┘          └───────────────────┘  │
│                                  ▲                     │
│                                  │ (Nuevo en 2C)       │
└──────────────────────────────────┼─────────────────────┘
                                   │
                           npx convex deploy
                                   │
┌──────────────────────────────────┴─────────────────────┐
│                     CÓDIGO LOCAL                       │
│  - convex/schema.ts (tabla trainingQueue)              │
│  - convex/kingdoms.ts (getArmyUnits & validadores)     │
│  - 61 pruebas unitarias y de integridad (100% OK)      │
└────────────────────────────────────────────────────────┘
```

---

## Fases de Ejecución

### Fase 1: Despliegue en Servidor Remoto
- Ejecutar el comando oficial `npx convex deploy`.
- Registrar la salida del proceso de Convex verificando:
  - Generación de bindings de TypeScript (`Generating TypeScript bindings`).
  - Creación del nuevo índice de tabla: `trainingQueue.by_kingdom`.
  - Finalización exitosa del push de esquema hacia el deployment remoto.

### Fase 2: Verificación Post-Despliegue y Pruebas
- Ejecutar la suite completa de pruebas económicas y de integridad (`scripts/runEconomicTests.ts`) para garantizar que las 61 pruebas sigan aprobadas al 100%.
- Ejecutar `compile_applet` para confirmar la coherencia de tipos y compilación limpia de la aplicación cliente.

### Fase 3: Informe de Estado y Cierre del Bloque
- Confirmar el estado del reino Iberia (inalterado y protegido en modo solo lectura).
- Dejar el backend listo para el siguiente bloque funcional (definición oficial de costes/tiempos y mutaciones autoritativas de reclutamiento).
