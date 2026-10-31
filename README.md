# Turtle Compiler

A compiler for a small turtle-graphics language that shows all six compiler phases working on your program, live in the browser: lexical analysis, syntax analysis, semantic analysis, intermediate code generation, code optimization and code generation for a small virtual machine that draws the picture.

```
PEN BLUE;
REPEAT 4 { MOVE 100; TURN 90; }
```

## What's here

| Path | What it is |
| --- | --- |
| `compiler/compiler.js` | The compiler: all six phases as plain functions. Shared by the website and the CLI. |
| `web/` | The website (Next.js, static export). |
| `cli/` | `turtlec`, the same compiler on the command line. |
| `examples/` | Example programs, including one error demo per phase that can fail. |
| `design/` | The Claude Design source files the website is generated from. |
| `demo/` | The first interactive prototype. |

## The language

Seven commands: `MOVE n;`, `TURN n;`, `PEN colour;`, `PENUP;`, `PENDOWN;`, `SET name = n;` and `REPEAT n { ... }`. Comments start with `#`. Distances run from 1 to 500, turns from -360 to 360, and loops from 1 to 100 and at most 3 deep. The language reference page on the site lists every rule.

## Website

```
cd web
npm install
npm run dev        # http://localhost:3000
npm run build      # static site in web/out
```

The pages are generated from the design files. After changing a file in `design/`, run `npm run convert` to regenerate `web/dc/generated/`.

`npm run convert` uses `web/tools/dc2jsx.mjs`, which turns each Claude Design file into a React component with the same markup, styles and logic. `node tools/pixel-diff.mjs` then screenshots the design and the built site in Chrome at 1440 and 390 pixels wide, in every example state, and compares them pixel by pixel. It needs `design/support.js` (Claude Design's runtime) and Google Chrome.

## Command line

```
node cli/turtlec.js examples/star.turtle
```

See `cli/README.md` for every option.

Built for the Compiler Design and Automata course.
