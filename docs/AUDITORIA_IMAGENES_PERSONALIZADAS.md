# INVENTARIO TÉCNICO DE RECURSOS GRÁFICOS — LA CONQUISTA

**Proyecto:** La Conquista  
**Fecha:** 18 de noviembre de 2026  
**Documento rector:** Actualización de 8 Puntos (Punto 7: Auditoría Gráfica y Documentación de Imágenes)

---

## 1. Objetivo y Alcance

Este documento constituye el inventario técnico completo de los elementos gráficos del juego *La Conquista*. Su propósito es clasificar cada elemento visual existente en la interfaz (React, Tailwind CSS, componentes canvas/SVG y assets estáticos), determinar su representación actual, establecer su compatibilidad con la sustitución por imagen, definir especificaciones técnicas (dimensiones, formato, transparencia y variantes) y estructurar una arquitectura ordenada de carga y gestión de recursos gráficos.

*Nota de cumplimiento:* En estricto cumplimiento de las restricciones del proyecto, este documento es exclusivamente un **inventario técnico y especificación de arquitectura**, sin generar, descargar ni incorporar ficheros de imagen binarios en esta fase.

---

## 2. Inventario Estructurado por Categorías

### 2.1. Mapa Mundial y Terrenos
| Elemento | Componente / Ruta | Representación Actual | Admite Imagen | Dimensiones / Relación | Formato / Variantes | Prioridad |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Hexágonos (Terrenos) | `src/components/Map.tsx`, `convex/territoryRules.ts` | Colores sólidos Tailwind / SVG paths | Sí (texturas de terreno) | 64x64 px (axial) | WebP / SVG (Llanura, Montaña, Bosque, Agua, Colina, Desierto) | Alta |
| Capital / Fortaleza | `src/components/Map.tsx` | Icono SVG integrado | Sí (sprite de castillo) | 32x32 px | SVG / PNG con transparencia (Por civilización) | Alta |
| Puntos de Interés / Recursos | `src/components/Map.tsx` | Iconos Lucide React | Sí (iconos temáticos) | 24x24 px | SVG | Media |

### 2.2. Edificios del Reino
| Elemento | Componente / Ruta | Representación Actual | Admite Imagen | Dimensiones / Relación | Formato / Variantes | Prioridad |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Castillo (Nivel 1-200) | `src/components/Buildings.tsx` | Tarjetas con gradientes y texto | Sí (ilustración de edificio) | 250x160 px (card hero) | WebP / PNG (5 rangos de nivel: 1, 50, 100, 150, 200) | Alta |
| Cuartel / Entrenamiento | `src/components/Buildings.tsx` | Iconos de UI y tarjetas | Sí (ilustración) | 250x160 px | WebP / PNG | Alta |
| Universidad | `src/components/Buildings.tsx` | Tarjetas UI | Sí (ilustración) | 250x160 px | WebP / PNG | Media |
| Murallas, Granja, Cantera, Mina, etc. | `src/components/Buildings.tsx` | Tarjetas UI | Sí (ilustración) | 250x160 px | WebP / PNG | Media |

### 2.3. Tropas y Unidades Militares
| Elemento | Componente / Ruta | Representación Actual | Admite Imagen | Dimensiones / Relación | Formato / Variantes | Prioridad |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Infantería, Arquería, Caballería, Asedio | `src/components/Army.tsx`, `convex/balanceConfig.ts` | Iconos SVG y avatares tipográficos | Sí (retrato de unidad) | 80x80 px (avatar) | WebP (Por nivel 1-5 y civilización) | Alta |
| Espías | `src/components/Army.tsx`, `convex/armyRules.ts` | Iconos SVG dedicados | Sí (retrato de espía) | 80x80 px | WebP | Alta |
| Mercenarios | `src/components/Army.tsx` | Insignias | Sí (emblema) | 80x80 px | WebP | Media |

### 2.4. Recursos Económicos
| Elemento | Componente / Ruta | Representación Actual | Admite Imagen | Dimensiones / Relación | Formato / Variantes | Prioridad |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Oro, Madera, Piedra, Hierro, Comida | `src/components/Header.tsx`, `src/components/Resources.tsx` | Iconos Lucide (Coins, Trees, Mountain, Anvil, Wheat) | Sí (iconos de recursos) | 20x20 px (inline) / 64x64 px (badge) | SVG / WebP | Alta |

### 2.5. Civilizaciones y Emblemas
| Elemento | Componente / Ruta | Representación Actual | Admite Imagen | Dimensiones / Relación | Formato / Variantes | Prioridad |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Escudos de las 12 Civilizaciones | `src/components/Civilizations.tsx`, `convex/civilizationRules.ts` | Siglas de texto y colores | Sí (estandarte / escudo) | 128x128 px | SVG (12 variantes de civilización) | Alta |

---

## 3. Arquitectura Propuesta de Gestión Gráfica

Para futuras fases de integración visual, se define la siguiente estructura estandarizada:

1. **Ruta base de assets:** `/public/assets/graphics/{category}/{id}_{variant}.webp`
2. **Sistema de Fallback:** Si un recurso gráfico no se encuentra disponible o está deshabilitado en configuración, el componente recurrirá automáticamente al icono vectorial SVG o representación tipográfica existente, garantizando 100% de robustez sin roturas visuales.
3. **Carga Diferida (Lazy Loading):** Los elementos pesados (ilustraciones de edificios y retratos de unidades en alta resolución) se cargarán bajo demanda mediante `loading="lazy"` o precarga selectiva por viewport.
