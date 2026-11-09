# Informe de Validación Teórica y Arquitectónica: Sistema de Nodos y Economía ("La Conquista")

**Rol:** Arquitecto de Sistemas & Diseñador de Juegos Grand Strategy  
**Estado:** Visto Bueno Teórico con Ajustes Recomendados para Convex  
**Documento:** `/docs/INFORME_VALIDACION_ARQUITECTURA_NODOS.md`  

---

## 1. Evaluación de la Estructura de Datos (Nodos y Aristas)

La estructura propuesta basada en un **Grafo Adyacente Ponderado** es altamente escalable y óptima para el motor de backend Convex.

### Fortalezas de Diseño:
1. **Desacoplamiento Celda/Ruta:** Separar los *Territorios* (Nodos) de las *Rutas* (Aristas) permite representar redes complejas (puentes, pasos de montaña, calzadas romanas) sin limitarse a una topología hexagonal fija.
2. **Consultas Rápidas en Convex:** La representación relacional `Ruta { nodoA, nodoB, peso, estaBloqueado }` permite ejecutar algoritmos de camino mínimo (Dijkstra / BFS) indexados por `nodoA`.

### Ajustes Recomendados en el Esquema de Datos:
* **Recuperación de Pacificación (`pacificationRate`):** Agregar un atributo `tasaPacificaciónTurno` (ej. $+0.05$ por turno pacificado) para regular la transición de $0.5 \to 1.0$.
* **Estado de Conexión Logística (`estaConectadoACapital`):** Atributo booleano calculado al final de cada turno para cortar la producción si un nodo queda totalmente cercado sin ruta continua a la capital o almacén regional.

---

## 2. Análisis de Balance Económico y Control de Inflación

### Fórmula Auditada:
$$\text{Producción} = \left\lfloor \text{Base}_{\text{recurso}} \times (1 + 0.25 \times \text{NivelEdificio}) \times \text{EficienciaControl} \right\rfloor$$

### Diagnóstico de Inflación:
* **Crecimiento Controlado:** El multiplicador máximo a nivel 3 es de $1.75$ ($+75\%$). Esto evita la hiperinflación exponencial común en otros títulos.
* **Freno Natural por Integración:** Al conquistar un nodo productivo rico, la eficiencia inicial de $0.50$ reduce a la mitad la ganancia ($1.75 \times 0.50 = 0.875$), forzando al jugador a invertir turnos y guarnición para pacificar el territorio antes de rentabilizar la conquista.

---

## 3. Análisis de Movilidad y Cuellos de Botella en Rutas

### Fórmula Auditada:
$$T_{\text{desplazamiento}} = \max\left(1,\, \left\lceil \frac{\text{PesoRuta} + \text{PenalizaciónTerreno} + \text{PenalizaciónClima}}{\text{VelocidadUnidad}} \right\rceil\right)$$

### Diagnóstico de Enrutamiento y Desplazamiento:
* **Garantía Mínima $T \ge 1$:** Evita el *exploit* de movimiento instantáneo entre nodos contiguos muy rápidos.
* **Prevención de Bloqueos Total (Cuellos de Botella):** Si `estaBloqueado == true`, la ruta no se pondera con peso infinito sino que se elimina dinámicamente de la lista de adyacencias del algoritmo BFS de movimiento, impidiendo desplazamientos inviables.

---

## 4. Edge Cases Identificados y Soluciones Técnicas

| Edge Case / Riesgo | Comportamiento Detectado | Solución Recomendada (Lógica Convex) |
| :--- | :--- | :--- |
| **Aislamiento Territorial (Isla Logística)** | Un nodo conquistado queda sin ruta física conectada a la capital debido a bloqueos enemigos. | Si `distanciaACapital == ∞`, el nodo entra en estado **"Suministros Cortados"**: producción reducida al $0\%$ y atrición continua a la guarnición. |
| **Reconquista Rápida (Ping-Pong)** | Un nodo es conquistado y reconquistado repetidamente en pocos turnos. | Al cambiar de propietario, el `factorDePacificacion` se reinicia a $0.50$ de inmediato y el nivel de edificio económico sufre un deterioro del $-1$ nivel por saqueo. |
| **Acumulación Extrema de Tropas en Nodos Pequeños** | Jugadores apilan 100.000 unidades en una empalizada de nivel 0. | Implementar la constante $\text{CapacidadSuministroNodo} = \text{Base} \times (1 + \text{NivelFortaleza})$, aplicando atrición por sobrepoblación militar si se excede. |

---

## 5. Dictamen Final y Visto Bueno

**VISTO BUENO TEÓRICO: CONCEDITO.**  
La estructura de datos y las ecuaciones analizadas son matemáticamente coherentes, previenen la hiperinflación y proporcionan una base sólida para el motor backend en Convex.
