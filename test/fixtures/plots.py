"""Make test PDFs for the viewer.

    uv run --no-project --with matplotlib python test/fixtures/plots.py            # write once
    uv run --no-project --with matplotlib python test/fixtures/plots.py --loop     # rewrite every 2 s
    uv run --no-project --with matplotlib python test/fixtures/plots.py --chunked  # slow partial writes

Output goes to test/fixtures/out/plots.pdf.
"""

import argparse
import io
import os
import time

import matplotlib

matplotlib.use("pdf")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "out", "plots.pdf")

# Common ROOT colours (kRed, kGreen, kBlue, kYellow, kMagenta, kCyan,
# kOrange, kAzure, kPink, kGreen+2).
ROOT_COLOURS = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff",
                "#00ffff", "#ffcc00", "#0099ff", "#ff0033", "#00cc00"]


def make_pdf(shift: float) -> bytes:
    x = np.linspace(0, 10, 200)
    buf = io.BytesIO()
    with PdfPages(buf) as pdf:
        # Page 1: tab10 lines.
        fig, ax = plt.subplots(figsize=(6, 4))
        for i in range(10):
            ax.plot(x, np.sin(x + i * 0.4 + shift) + i * 0.3, label=f"C{i}")
        ax.set_title(r"tab10 lines, $\sigma$ = 1.0, $\mu \to \infty$")
        ax.set_xlabel(r"$m_{\gamma\gamma}$ [GeV]")
        ax.legend(ncol=5, fontsize=7)
        pdf.savefig(fig)
        plt.close(fig)

        # Page 2: Brazil band limit plot.
        fig, ax = plt.subplots(figsize=(6, 4))
        exp = 1 + 0.2 * np.sin(x / 2 + shift)
        ax.fill_between(x, exp * 0.5, exp * 1.8, color="#ffff00", label=r"Expected $\pm 2\sigma$")
        ax.fill_between(x, exp * 0.7, exp * 1.35, color="#00ff00", label=r"Expected $\pm 1\sigma$")
        ax.plot(x, exp, "k--", label="Expected")
        ax.plot(x[::10], exp[::10] * (1 + 0.15 * np.cos(x[::10] * 3)), "ko-", label="Observed")
        ax.set_title("Brazil band (kGreen / kYellow)")
        ax.legend(fontsize=8)
        pdf.savefig(fig)
        plt.close(fig)

        # Page 3: ROOT colours and an image with a colour bar.
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(8, 4))
        for i, c in enumerate(ROOT_COLOURS):
            ax1.plot(x, x * 0 + i, color=c, lw=3)
            ax1.text(10.2, i, c, va="center", fontsize=7)
        ax1.set_title("ROOT colours")
        img = np.outer(np.sin(np.linspace(0, 3, 50) + shift), np.cos(np.linspace(0, 3, 50)))
        im = ax2.imshow(img, cmap="viridis")
        fig.colorbar(im, ax=ax2)
        ax2.set_title("imshow (raster)")
        fig.tight_layout()
        pdf.savefig(fig)
        plt.close(fig)
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", action="store_true", help="rewrite in place every 2 s")
    ap.add_argument("--chunked", action="store_true", help="write slowly in chunks")
    args = ap.parse_args()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    shift = 0.0
    while True:
        data = make_pdf(shift)
        with open(OUT, "wb") as f:
            if args.chunked:
                step = max(1, len(data) // 8)
                for i in range(0, len(data), step):
                    f.write(data[i:i + step])
                    f.flush()
                    time.sleep(0.4)
            else:
                f.write(data)
        print(f"wrote {OUT} ({len(data)} bytes, shift={shift:.1f})")
        if not (args.loop or args.chunked):
            break
        shift += 0.5
        time.sleep(2)


if __name__ == "__main__":
    main()
