"""Independent pandas reference; run from any directory with pandas installed."""
from pathlib import Path
import pandas as pd

PERIOD = 14
rows = []
for i in range(60):
    center = 100 + ((i * 7) % 19) + (25 if i >= 35 else 0)
    rows.append({
        "minute": (pd.Timestamp("2026-10-04T12:00:00Z") + pd.Timedelta(minutes=i)).isoformat(),
        "open": center,
        "high": center + 2 + i % 4,
        "low": center - 1 - i % 3,
        "close": center + (1 if i % 2 else -1),
    })
frame = pd.DataFrame(rows)
previous = frame["close"].shift(1)
frame["tr"] = pd.concat([
    frame["high"] - frame["low"],
    (frame["high"] - previous).abs(),
    (frame["low"] - previous).abs(),
], axis=1).max(axis=1)
seeded = pd.concat([
    pd.Series([frame["tr"].iloc[:PERIOD].mean()], index=[PERIOD - 1]),
    frame["tr"].iloc[PERIOD:],
])
frame["atr"] = seeded.ewm(alpha=1 / PERIOD, adjust=False).mean()
output = Path(__file__).with_name("atr_reference.csv")
frame.to_csv(output, index=False, float_format="%.12f", na_rep="")
print(f"pandas {pd.__version__}: {len(frame)} rows -> {output}")
