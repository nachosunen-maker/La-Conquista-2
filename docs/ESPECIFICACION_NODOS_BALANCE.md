# Especificación Matemática de Nodos, Balance Económico, Desplazamiento, Asedio y Logística ("La Conquista")

**Estado:** Especificación Maestra de Backend (Convex)  
**Documento:** `/docs/ESPECIFICACION_NODOS_BALANCE.md`  

---

## 1. Producción de Recursos por Turno

Calcula los recursos generados en cada territorio controlado al finalizar un turno, considerando infraestructura y nivel de integración social.

### Fórmula:
$$\text{Producción}_{\text{turno}} = \left\lfloor \text{Base}_{\text{recurso}} \times \left(1 + 0.25 \times \text{NivelEdificio}\right) \times \text{EficienciaControl} \right\rfloor$$

### Definición de Variables:
* $\text{Base}_{\text{recurso}} \in \mathbb{R}^+$: Valor base de producción del nodo (ej. 10 de Oro, 5 de Hierro, 15 de Alimento).
* $\text{NivelEdificio} \in \{0, 1, 2, 3\}$: Nivel de la infraestructura extractiva/económica instalada ($0 = +0\%$, $1 = +25\%$, $2 = +50\%$, $3 = +75\%$).
* $\text{EficienciaControl} \in [0.50, 1.00]$: Nivel de integración y pacificación territorial:
  * $0.50$: Territorio recién conquistado con alta agitación / revuelta.
  * $1.00$: Territorio pacificado e integrado completamente al reino.

---

## 2. Tiempo y Coste de Desplazamiento entre Nodos

Determina la duración en turnos o minutos del traslado de un ejército desde un nodo $A$ hasta un nodo $B$ conectado en la red geopolítica.

### Fórmula:
$$T_{\text{desplazamiento}}(A \to B) = \max\left(1,\, \left\lceil \frac{\text{PesoRuta}(A, B) + \text{PenalizaciónTerreno} + \text{PenalizaciónClima}}{\text{VelocidadUnidad}} \right\rceil\right)$$

### Definición de Variables:
* $\text{PesoRuta}(A, B) \in \mathbb{R}^+$: Dificultad intrínseca del camino entre nodos ($1.0$ Calzada/Camino comercial, $1.5$ Ruta estándar, $2.0$ Senda de montaña).
* $\text{VelocidadUnidad} \in \mathbb{R}^+$: Atributo de movilidad del cuerpo militar ($2.0$ Caballería ligera, $1.5$ Infantería ligera, $1.0$ Infantería pesada / Maquinaria de asedio).
* $\text{PenalizaciónTerreno} \ge 0$: Modificador geográfico del bioma ($0.0$ Llanura, $+0.5$ Colina/Bosque denso, $+1.0$ Pantano/Montaña alta).
* $\text{PenalizaciónClima} \ge 0$: Modificador meteorológico dinámico ($0.0$ Despejado, $+0.5$ Lluvia/Barro, $+1.0$ Invierno severo/Nieve).
* **Cota Inferior:** $T_{\text{desplazamiento}} \ge 1$ turno/minuto.

---

## 3. Poder Defensivo y Desgaste por Asedio (Atrición)

Calcula la resistencia de un nodo fortificado y las bajas por atrición que sufren los atacantes en misiones de asedio prolongado.

### 3.1 Poder Defensivo del Nodo ($\text{Defensa}_{\text{nodo}}$):
$$\text{Defensa}_{\text{nodo}} = \text{Defensa}_{\text{base}} \times \left(1 + 0.50 \times \text{NivelFortaleza}\right)$$

* $\text{Defensa}_{\text{base}}$: Valor defensivo propio del terreno.
* $\text{NivelFortaleza} \in \{0, 1, 2, 3\}$: Nivel de infraestructura defensiva ($0$ Sin fortificación, $1$ Empalizada, $2$ Muralla de piedra, $3$ Ciudadela fortificada).

### 3.2 Desgaste por Asedio ($\text{Atrición}_{\text{turno}}$):
$$\text{TasaAtrición} = \min\left(0.40,\, 0.02 + 0.05 \times \text{NivelFortaleza} + 0.08 \times \text{SuministrosAgotados}\right)$$
$$\text{Atrición}_{\text{turno}} = \left\lfloor \text{Tropas}_{\text{atacantes}} \times \text{TasaAtrición} \right\rfloor$$

* $\text{Tropas}_{\text{atacantes}}$: Total de efectivos sitiando el nodo.
* $\text{NivelFortaleza} \in \{0, 1, 2, 3\}$: Aporta $+5\%$ de bajas adicionales por turno según el nivel de defensa.
* $\text{SuministrosAgotados} \in \{0, 1, 2, \dots\}$: Nivel de desabastecimiento por corte de rutas de suministro ($+8\%$ de atrición extra por nivel/turno sin alimentos).
* **Cota Superior:** Tasa máxima de atrición capada al $40\%$ por turno.

---

## 4. Penalización de Líneas de Suministro (Distancia al Núcleo Logístico)

Penaliza los ejércitos que operan más allá de su rango logístico seguro en el mapa de nodos.

### Cálculo de Exceso de Saltos ($\Delta \text{Saltos}$):
$$\Delta \text{Saltos} = \max\left(0,\, \text{DistanciaMinimaACapital} - \text{RangoLogistico}\right)$$

### 4.1 Incremento del Coste de Mantenimiento:
$$\text{MultiplicadorMantenimiento} = 1.0 + 0.15 \times \Delta \text{Saltos}$$
*(Coste de grano y paga militar aumentado un $+15\%$ por cada salto excedente).*

### 4.2 Penalización a la Moral de Combate:
$$\text{PenalizaciónMoral} = \min\left(0.50,\, 0.05 \times \Delta \text{Saltos}\right)$$
$$\text{FuerzaEfectiva} = \text{FuerzaBase} \times \left(1.0 - \text{PenalizaciónMoral}\right)$$
*(Reducción del $5\%$ de moral/efectividad en combate por salto excedente, capada a un máximo del $50\%$).*

---

## 5. Resumen de Parámetros de Balance (Convex Engine)

| Parámetro | Rango / Valor | Función |
| :--- | :---: | :--- |
| $\text{NivelEdificio}$ | $0 \dots 3$ | Bonus de producción ($+25\%$ por nivel) |
| $\text{EficienciaControl}$ | $0.50 \dots 1.00$ | Penalización por agitación tras conquista |
| $T_{\min}$ | $1$ | Tiempo mínimo de marcha entre nodos |
| $\text{NivelFortaleza}$ | $0 \dots 3$ | Multiplicador de defensa ($+50\%$/nivel) y atrición ($+5\%$/nivel) |
| $\text{SuministrosAgotados}$ | $0 \dots 5$ | Atrición por hambre ($+8\%$/nivel) |
| $\text{RangoLogistico}$ Base | $3$ saltos | Distancia segura sin penalización |
| $\Delta \text{Mantenimiento}$ | $+15\%$ / salto | Recargo logístico por exceso de distancia |
| $\Delta \text{Moral}$ | $-5\%$ / salto (max $50\%$) | Penalización de combate por lejanía logológica |
