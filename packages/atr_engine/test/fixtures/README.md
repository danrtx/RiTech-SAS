# Referencia independiente ATR

`atr_reference.csv` contiene 60 velas OHLC deterministas, TR y ATR Wilder de periodo 14. Se generó con Python y **pandas 3.0.1**, fuera del código Dart; no es un resultado copiado del motor.

Regenerar desde la raíz de este paquete:

```powershell
python -m pip install pandas==3.0.1
python test/fixtures/generate_reference.py
```

El generador usa máximos vectorizados para TR, con `high-low` en la primera fila. Calcula la media de los primeros 14 TR y aplica `ewm(alpha=1/14, adjust=False)` a una serie que comienza con esa semilla. Los primeros 13 ATR quedan vacíos. Algunas bibliotecas omiten el primer TR por no existir cierre previo; esa convención no corresponde al requisito de esta implementación.

Se guardan 12 decimales. Los tests comparan los 47 ATR calculables con error absoluto <=1e-6, tanto directamente con el calculador como reconstruyendo OHLC a partir de ticks en la caché. El dataset incluye rangos variables, saltos entre cierres y aperturas y un aumento de nivel desde la vela 35.

Python/pandas se requieren solo para regenerar este archivo, no para ejecutar los tests Dart. La referencia no se regenera durante los tests.
