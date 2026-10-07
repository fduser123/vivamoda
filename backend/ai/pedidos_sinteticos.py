#!/usr/bin/env python3
"""
Genera HISTORIAL DE PEDIDOS para que la IA administrativa tenga de qué hablar.

POR QUÉ
-------
El asistente del panel (pestañas Previsión, Anomalías, ABC y Estrategia)
analiza las tablas `orders` y `order_items`. Sólo había 22 pedidos de demo con
35 líneas, así que la clasificación ABC no discriminaba nada, no había serie
temporal donde buscar anomalías y el histórico no daba para prever.

Se reconstruyen pedidos a partir de `sales_history`, que ya es sintético, de
modo que ambas fuentes son coherentes entre sí. Todas las filas llevan
`notes = '[sintético]'` para poder distinguirlas y borrarlas.

NO toca el inventario: son pedidos históricos ya cerrados, así que descontar
stock ahora dejaría las existencias actuales sin sentido.
"""
import random
import sys
from datetime import date, datetime, timedelta

import numpy as np
import psycopg

DSN = "postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda"
SEED = 20261008
OBJETIVO_PEDIDOS = 1500
MARCAS = ["[sintético]"]

CANALES = [("web", 42), ("app", 20), ("whatsapp", 14), ("retiro", 12), ("shopify", 8), ("pos", 4)]
CIUDADES = ["Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Bucaramanga"]
NOMBRES = ["Elena R.", "Carlos M.", "Laura G.", "Ana P.", "Diego S.", "Marta L.", "Julián V.",
           "Sofía T.", "Andrés B.", "Camila N.", "Felipe O.", "Valentina C.", "Ricardo H.",
           "Paula M.", "Sebastián D.", "Isabella F.", "Tomás G.", "Daniela R."]


def main():
    rng = np.random.default_rng(SEED)
    random.seed(SEED)

    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT s.sku, s.store_code, s.week_start, s.units_sold, s.price,
                   s.promo_flag, s.promo_depth
            FROM sales_history s WHERE s.units_sold > 0
        """)
        ventas = cur.fetchall()

        cur.execute("SELECT id, sku, price::float8 FROM products WHERE is_active")
        productos = {r[1]: {"id": r[0], "precio": float(r[2] or 30)} for r in cur.fetchall()}
        cur.execute("SELECT id, code FROM stores")
        tiendas = {r[1]: r[0] for r in cur.fetchall()}
        cur.execute("SELECT v.id, v.product_id, v.size, v.color FROM product_variants v")
        variantes = {}
        for vid, pid, size, color in cur.fetchall():
            variantes.setdefault(pid, []).append((vid, size, color))

    print(f"[pedidos] {len(ventas)} combinaciones SKU/tienda/semana con venta")

    # Cada fila de ventas semanales se convierte en 1..n pedidos, según unidades
    candidatas = []
    for (sku, store, semana, unidades, precio, promo, prof) in ventas:
        if sku not in productos or store not in tiendas:
            continue
        n = min(int(unidades), 4)          # hasta 4 pedidos por celda
        for _ in range(n):
            candidatas.append((sku, store, semana, float(precio or 30), promo, float(prof or 0)))
    print(f"[pedidos] candidatos: {len(candidatas)}")

    rng.shuffle(candidatas)
    seleccion = candidatas[:OBJETIVO_PEDIDOS]

    pedidos, items = [], []
    for i, (sku, store, semana, precio, promo, prof) in enumerate(seleccion):
        p = productos[sku]
        # Fecha dentro de esa semana
        dia = semana + timedelta(days=int(rng.integers(0, 7)))
        if dia > date.today():
            dia = date.today()
        ts = datetime.combine(dia, datetime.min.time()) + timedelta(
            hours=int(rng.integers(9, 21)), minutes=int(rng.integers(0, 60)))
        canal = random.choices([c for c, _ in CANALES], weights=[w for _, w in CANALES])[0]
        descuento = round(precio * prof, 2) if promo else 0.0
        precio_final = round(precio - descuento, 2)

        # Algunas líneas extra (el cliente compra más de una prenda)
        n_extra = int(rng.integers(0, 3))
        lineas = [(sku, precio_final, 1)]
        for _ in range(n_extra):
            otro = random.choice(list(productos.keys()))
            lineas.append((otro, round(productos[otro]["precio"], 2), int(rng.integers(1, 3))))

        subtotal = round(sum(pr * q for _, pr, q in lineas), 2)
        impuesto = round(subtotal * 0.07, 2)
        total = round(subtotal + impuesto - descuento, 2)
        pagado = rng.random() < 0.88
        estado = random.choices(
            ["delivered", "picking", "packed", "in_transit", "pendiente", "cancelled"],
            weights=[40, 18, 12, 12, 12, 6])[0]

        pedidos.append((
            f"VM-{20000 + i}", None, tiendas[store], canal, estado,
            random.choice(NOMBRES), f"+57 30{int(rng.integers(0, 10))} {int(rng.integers(100,999))} {int(rng.integers(1000,9999))}",
            f"Calle {int(rng.integers(1, 200))} #{int(rng.integers(1,90))}-{int(rng.integers(1,90))}",
            random.choice(CIUDADES), None, None,
            random.choice(["tarjeta", "contraentrega", "transferencia", "efectivo"]),
            pagado, subtotal, descuento, impuesto, total,
            bool(rng.random() < 0.35), None, random.choice(MARCAS), ts, ts,
        ))
        items.append((i, lineas))

    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE notes = ANY(%s))", (MARCAS,))
        cur.execute("DELETE FROM orders WHERE notes = ANY(%s)", (MARCAS,))
        print(f"[pedidos] insertando {len(pedidos)} pedidos…")

        ids = []
        for fila in pedidos:
            cur.execute("""
                INSERT INTO orders (order_no, user_id, store_id, channel, status, customer_name,
                                    customer_phone, address, city, courier, tracking_no, payment_method,
                                    paid, subtotal, discount, tax, total, ai_assisted, cashier_id, notes,
                                    created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
            """, fila)
            ids.append(cur.fetchone()[0])

        filas_items = []
        for idx, lineas in items:
            oid = ids[idx]
            for (sku_l, pr, q) in lineas:
                pid = productos.get(sku_l, {}).get("id")
                if not pid:
                    continue
                vars_ = variantes.get(pid) or [(None, None, None)]
                vid, size, color = random.choice(vars_)
                filas_items.append((oid, pid, vid, sku_l, size, color, pr, q))

        cur.executemany("""
            INSERT INTO order_items (order_id, product_id, variant_id, product_name, sku, size, color, unit_price, qty)
            VALUES (%s,%s,%s,(SELECT name FROM products WHERE id=%s),%s,%s,%s,%s,%s)
        """, [(o, p, v, p, s, sz, c, pr, q) for (o, p, v, s, sz, c, pr, q) in filas_items])
        conn.commit()

    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*), COUNT(DISTINCT oi.product_id), SUM(o.total)::numeric(12,2),
                   MIN(o.created_at)::date, MAX(o.created_at)::date
            FROM orders o JOIN order_items oi ON oi.order_id = o.id
        """)
        n, skus, tot, d0, d1 = cur.fetchone()
    print(f"[pedidos] FIN · {n} líneas · {skus} SKUs distintos · ${tot} · {d0} → {d1}")


if __name__ == "__main__":
    main()
