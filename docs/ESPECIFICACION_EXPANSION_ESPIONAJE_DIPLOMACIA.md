# Especificación Técnica y Algorítmica Consolidada: Sistema de Expansión, Espionaje y Diplomacia ("La Conquista")

**Estado:** Especificación Maestra Validada de Reglas de Negocio y Balance  
**Documento:** `/docs/ESPECIFICACION_EXPANSION_ESPIONAJE_DIPLOMACIA.md`  

---

## 1. Ampliación del Mapa Hexagonal (7.600 Celdas) y Algoritmo de Spawn

* **Geometría Axial:** Coordenadas axiales $(q, r)$ con restricción de radio:
  $$\max(|q|,\, |r|,\, |q + r|) \le 49$$
* **Validación de Límites:** $N \approx 7.600$ celdas totales ($7.351$ celdas habitables de terreno activo).
* **Métrica de Distancia Axial:**
  $$D(A, B) = \frac{|q_1 - q_2| + |r_1 - r_2| + |(q_1 + r_1) - (q_2 + r_2)|}{2}$$
* **Algoritmo de Spawn:**
  * **Distancia Mínima:** $D_{\text{min}} \ge 6$ celdas para todas las capitales activas.
  * **Clústeres Culturales:** Asignación en el radio de influencia del centro geopolítico de la civilización $C_k$.
  * **Búfer Perimetral:** Inhabilitación y reserva inicial de $\Delta D = 2$ capas de celdas en torno a la nueva capital para permitir expansión fluida.

---

## 2. Lógica y Fórmulas del Sistema de Espionaje

* **Límite Teórico de Espías Activos:**
  $$E_{\text{max}} = \max\left(1, \left\lfloor \frac{\text{nivel\_cuartel}}{2} \right\rfloor\right)$$
* **Tiempo de Marcha de Grupo ($D, E$):**
  $$T_{\text{viaje}} = \frac{T_{\text{base}} \cdot D}{1 + 0.15 \cdot (E - 1)} \quad \text{con } T_{\text{base}} = 1800\,\text{segundos}$$
* **Fiabilidad del Informe de Inteligencia ($I_{\text{precisión}}$):**
  $$I_{\text{precisión}} = \min\left(100\%, \frac{E \cdot 40}{D^{0.3}}\right)$$
* **Regla de Error Estocástico:** Si $I_{\text{precisión}} < 50\%$, se aplica una fluctuación de $\pm 30\%$ en las tropas visibles.

---

## 3. Lógica de Exploración, Anexión y Bonificaciones Territoriales

* **Fase de Exploración:** Transición de `inexplorada` a `explorada` tras marcha a distancia $D \le 1$.
* **Fase de Reclamación:** Requisito de expedición con $\ge 10$ tropas hacia celda contigua explorada.
* **Recompensas de Anexión:**
  $$\text{Honor} = \text{Honor} + 1, \quad \text{Gloria} = \text{Gloria} + 1$$
* **Producción Acumulativa por Terreno:**
  $$P_{\text{total}} = P_{\text{base}} \cdot \left(1 + \sum(\text{Bosques} \cdot 0.15) + \sum(\text{Montañas} \cdot 0.15) + \sum(\text{Colinas} \cdot 0.10) + \sum(\text{Llanuras} \cdot 0.10)\right)$$

---

## 4. Matriz Diplomática y Resolución de Victorias Territoriales

* **Opciones Fronterizas:** `[Desafiar, Espiar, Ignorar]`.
* **Pérdida Territorial por "Victoria Aplastante":**
  $$\text{Si } \frac{\text{poder\_vencedor\_restante}}{\text{poder\_perdedor\_inicial}} \ge 2.5:$$
  * La celda transfiere inmediatamente su soberanía al atacante vencedor.
* **Alianzas Secretas:**
  * **Requisito:** `Parlamento` de nivel $\ge 15$.
  * **Bandera DB:** `es_secreta = true`.
  * **Transferencia de Recursos entre Aliados:**
    $$\text{recursos\_recibidos} = \text{recursos\_enviados} \cdot (1 - 0.02 \cdot D(A, B))$$
