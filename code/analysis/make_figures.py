"""Reproduce the portfolio figures and the Study 2 robustness check.

Inputs (not published): the Study 1 and Study 2 Excel workbooks.
Usage: python make_figures.py <study1.xlsx> <study2.xlsx> <outdir>
"""
import sys, pandas as pd, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import statsmodels.formula.api as smf

s1f, s2f, out = sys.argv[1:4]
INK, MUTED, GRID = "#202124", "#5f6368", "#e8eaed"
WET, URB, ALT = "#1a73e8", "#e8710a", "#7a5aa6"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10.5, "axes.edgecolor": MUTED,
    "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False,
    "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8,
    "figure.dpi": 200, "savefig.bbox": "tight", "savefig.facecolor": "white"})

s1 = pd.read_excel(s1f, sheet_name="S1 Raw Data", header=3).iloc[:, :6]
s1.columns = ["ym", "m", "wet", "urb", "diff", "season"]
s1["date"] = pd.to_datetime(s1.ym)

# Fig 1: monthly LST
fig, ax = plt.subplots(figsize=(8, 3.4))
ax.plot(s1.date, s1.urb, color=URB, lw=1.8, label="Data Center Alley (urban, Ashburn)")
ax.plot(s1.date, s1.wet, color=WET, lw=1.8, label="Occoquan Bay NWR (wetland)")
ax.set_ylabel("Daytime LST (°C)"); ax.legend(frameon=False, loc="upper left", ncol=2, fontsize=9)
ax.set_ylim(top=s1[["wet","urb"]].max().max() + 6)
fig.savefig(f"{out}/fig1_lst_timeseries.png"); plt.close(fig)

# Fig 2: seasonal mean difference with 95% CI
order = ["Winter", "Spring", "Summer", "Fall"]
g = s1.groupby("season")["diff"].agg(["mean", "std", "count"]).loc[order]
g["ci"] = 1.96 * g["std"] / np.sqrt(g["count"])
fig, ax = plt.subplots(figsize=(6, 3.2))
cols = [MUTED, WET, WET, WET]
ax.bar(order, g["mean"], color=cols, width=0.6, yerr=g["ci"], capsize=4, ecolor=INK)
ax.axhline(0, color=INK, lw=0.8)
for i, v in enumerate(g["mean"]):
    ci = g["ci"].iloc[i]
    ax.text(i + 0.33, v, f"{v:+.2f}", ha="left", va="center", fontsize=9.5, color=INK)
ax.set_ylabel("Wetland − urban LST (°C)"); ax.grid(axis="x", visible=False)
fig.savefig(f"{out}/fig2_seasonal_difference.png"); plt.close(fig)

# Study 2
s2 = pd.read_excel(s2f, sheet_name="S2 Raw Data", header=3).iloc[:, [0, 1, 2, 3, 6, 13]]
s2.columns = ["ym", "season", "W", "T", "NDVI", "K"]
s2["month"] = s2.ym.str[5:]

# Fig 3: water vs temperature by cooling regime
fig, ax = plt.subplots(figsize=(6.4, 3.6))
for k, c, lab in [(0, URB, "Before Apr 2023"), (1, WET, "After Apr 2023 (Kyoto Cooling)")]:
    d = s2[s2.K == k]; r = smf.ols("W ~ T", d).fit()
    ax.scatter(d["T"], d.W, s=22, color=c, alpha=0.85, label=f"{lab}: slope {r.params['T']:.3f}")
    xs = np.linspace(d["T"].min(), d["T"].max(), 50); ax.plot(xs, r.params.Intercept + r.params["T"] * xs, color=c, lw=1.6)
ax.set_xlabel("Monthly mean air temperature, Dulles (°C)"); ax.set_ylabel("Groundwater withdrawal (M gal / month)")
ax.legend(frameon=False, fontsize=9, loc="upper left"); ax.set_ylim(top=s2.W.max() + 0.8)
fig.savefig(f"{out}/fig3_water_temperature.png"); plt.close(fig)

# Fig 4: robustness of the temperature coefficient
specs = [("Temperature only", "W ~ T", None),
         ("+ season dummies + NDVI + regime (draft Model 4)", "W ~ T + NDVI + C(season) + K", None),
         ("Model 4, HAC standard errors", "W ~ T + NDVI + C(season) + K", 3),
         ("Month-of-year fixed effects + regime", "W ~ T + NDVI + C(month) + K", None),
         ("Month FE, HAC standard errors", "W ~ T + NDVI + C(month) + K", 3)]
rows = []
for name, f, lag in specs:
    r = smf.ols(f, s2).fit(cov_type="HAC", cov_kwds={"maxlags": lag}) if lag else smf.ols(f, s2).fit()
    lo, hi = r.conf_int().loc["T"]; rows.append((name, r.params["T"], lo, hi, r.pvalues["T"]))
rob = pd.DataFrame(rows, columns=["spec", "beta", "lo", "hi", "p"])
rob.to_csv(f"{out}/study2_robustness.csv", index=False)
fig, ax = plt.subplots(figsize=(7.2, 3.0))
y = np.arange(len(rob))[::-1]
for yi, (_, r) in zip(y, rob.iterrows()):
    c = WET if r.p < 0.05 else MUTED
    ax.plot([r.lo, r.hi], [yi, yi], color=c, lw=2); ax.plot(r.beta, yi, "o", color=c, ms=7)
    ax.text(r.hi + 0.004, yi, ("p < 0.001" if r.p < 0.001 else f"p = {r.p:.3f}"), va="center", fontsize=9, color=c)
ax.axvline(0, color=INK, lw=0.8); ax.set_yticks(y); ax.set_yticklabels(rob.spec, fontsize=9)
ax.set_xlabel("β temperature (M gal per °C per month), 95% CI"); ax.grid(axis="y", visible=False)
ax.set_xlim(right=rob.hi.max() + 0.04)
fig.savefig(f"{out}/fig4_robustness.png"); plt.close(fig)
print(rob.round(4).to_string())
print(g.round(3))
