# Paper

**[turtle_compiler_ieee.pdf](turtle_compiler_ieee.pdf)**: *Turtle Compiler: An Interactive Six Phase Compiler for a Turtle Graphics Language*, an IEEE conference format report (7 pages) on the language, the six phases, the Turtle VM and an evaluation on the example programs.

| File | What it is |
| --- | --- |
| `main.tex` | The LaTeX source (IEEEtran, conference mode) |
| `figures/` | Screenshots of the website used as figures |
| `turtle_compiler_ieee.pdf` | The compiled paper |

## Building

The paper builds with [Tectonic](https://tectonic-typesetting.github.io), which fetches the LaTeX packages it needs on the first run:

```bash
cd paper
tectonic main.tex
mv main.pdf turtle_compiler_ieee.pdf
```

The figures were captured from a local build of the website (`cd web && npm run build`) in headless Chrome at 1440 px wide and 2x scale. The numbers in the evaluation table come from compiling the programs in `examples/` with `compiler/compiler.js`.
