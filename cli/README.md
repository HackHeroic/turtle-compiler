# turtlec

`turtlec` is the command-line front end for the Turtle compiler. It runs the same six phases as the website (`compiler/compiler.js`) and prints what each one produced.

Needs Node 20 or newer. No dependencies.

```
node cli/turtlec.js examples/star.turtle
```

To get a `turtlec` command on your path, run `npm link` inside `cli/`.

## Usage

```
turtlec 0.1.0: compiler for the Turtle graphics language

Usage:
  turtlec <file.turtle> [options]   compile and print a report of all six phases
  turtlec run <file.tvm> [options]  run machine code written with --bin

Options:
  --phase <name>     print one phase in full detail:
                     lex, parse, sem, ir, opt, gen or run
  --svg <out.svg>    write the drawing as SVG
  --bin <out.tvm>    write the machine code (4 bytes per instruction)
  --no-color         plain output (also when NO_COLOR is set or not a terminal)
  --color            force coloured output
  -h, --help         show this help
  --version          show the version

Use - as the file name to read the program from standard input.

Exit status: 0 compiled, 1 compile or machine code error, 2 usage or file error.
```

| Command | What it does |
| --- | --- |
| `turtlec prog.turtle` | Compact report of all six phases, then a run summary. |
| `turtlec prog.turtle --phase parse` | One phase in full detail. `parse` adds the Stack, Input, Action trace, `ir` adds quadruples, `opt` adds basic blocks before and after. |
| `turtlec prog.turtle --svg out.svg` | Writes the drawing as SVG. |
| `turtlec prog.turtle --bin out.tvm` | Writes the machine code, 4 bytes per instruction. |
| `turtlec run out.tvm` | Decodes the machine code, runs it on the Turtle VM and prints the run summary. `--svg` works here too. |
| `cat prog.turtle \| turtlec -` | Reads the program from standard input. |

Output is coloured on a terminal. `--no-color`, `NO_COLOR=1` or piping the output turn colour off.

Exit status: `0` compiled, `1` compile error or bad machine code, `2` usage or file error.

## Example session

```
$ turtlec examples/square.turtle
turtlec 0.1.0  examples/square.turtle

1  Lexical analysis                                 14 tokens (with EOF)
------------------------------------------------------------------------
    2  KEYWORD(PEN) IDENT(BLUE) SEMI(;)
    3  KEYWORD(REPEAT) NUMBER(4) LBRACE({) KEYWORD(MOVE) NUMBER(100)
       SEMI(;) KEYWORD(TURN) NUMBER(90) SEMI(;) RBRACE(})
    4  EOF

2  Syntax analysis                                    accepted, 29 nodes
------------------------------------------------------------------------
  LL(1) parse accepted in 28 steps. Parse tree:
    program
      stmt_list
        stmt
          PEN
          IDENT BLUE
          ;
        stmt_list
          stmt
            REPEAT
            value
              NUMBER 4
            {
            stmt_list
              stmt
                MOVE
                value
                  NUMBER 100
                ;
              stmt_list
                stmt
                  TURN
                  value
                    NUMBER 90
                  ;
                stmt_list
                  ε
            }
          stmt_list
            ε

3  Semantic analysis                      5 checks, 0 errors, 0 warnings
------------------------------------------------------------------------
  ✓ S3  line 2   BLUE is in the colour table
  ✓ S7  line 3   REPEAT at depth 1 (limit 3)
  ✓ S6  line 3   REPEAT 4 is inside 1 to 100
  ✓ S4  line 3   MOVE 100 is inside 1 to 500
  ✓ S5  line 3   TURN 90 is inside -360 to 360

  Symbol table
    (empty)

4  Intermediate code                      10 lines of three-address code
------------------------------------------------------------------------
    1      color BLUE                ; line 2
    2      t1 = 4                    ; line 3
    3  L1:                           ; line 3
    4      if t1 <= 0 goto L2        ; line 3
    5      move 100                  ; line 3
    6      turn 90                   ; line 3
    7      t1 = t1 - 1               ; line 3
    8      goto L1                   ; line 3
    9  L2:                           ; line 3
   10      halt                      ; line 3

5  Code optimization                                0 changes in 1 round
------------------------------------------------------------------------
  Nothing to optimize.

  Instructions  8 -> 8   (labels not counted)
  Steps run     24 -> 24
  Same drawing  yes

6  Code generation                              8 instructions, 32 bytes
------------------------------------------------------------------------
  0000  20 00 00 05  COL  #BLUE        ; color BLUE
  0001  30 01 00 04  LDI  R1, #4       ; t1 = 4
  0002  40 01 00 07  JLE  R1, 0007     ; if t1 <= 0 goto L2
  0003  10 00 00 64  FWD  #100         ; move 100
  0004  11 00 00 5A  RGT  #90          ; turn 90
  0005  31 01 00 00  DEC  R1           ; t1 = t1 - 1
  0006  41 00 00 02  JMP  0002         ; goto L1
  0007  FF 00 00 00  HLT               ; halt

Run                                                             24 steps
------------------------------------------------------------------------
  Steps           24
  Lines drawn     4
  Final position  x 0, y 0
  Heading         0°
  Pen             down, BLUE
```

Errors use the usual `file:line:col` form, with the source line, a caret and a hint:

```
$ turtlec examples/synerr.turtle
examples/synerr.turtle:4:3: syntax error: Expected ; after "100" but found "TURN".
    4 |   TURN 90;
      |   ^~~~
      = hint: Every command ends with a semicolon.
1 error.

$ turtlec examples/semerr.turtle
examples/semerr.turtle:2:5: semantic error: GOLD is not a colour. Use one of RED, ORANGE, YELLOW, GREEN, CYAN, BLUE, PURPLE, PINK, WHITE. [S3]
    2 | PEN GOLD;           # not a colour
      |     ^~~~
examples/semerr.turtle:3:8: semantic error: REPEAT 0 is outside 1 to 100. [S6]
    3 | REPEAT 0 {          # must run at least once
      |        ^
examples/semerr.turtle:4:8: semantic error: MOVE side (= 900) is outside 1 to 500. [S4]
    4 |   MOVE side;        # 900 is more than 500
      |        ^~~~
examples/semerr.turtle:6:6: semantic error: width is used but was never SET. [S1]
    6 | MOVE width;         # width was never SET
      |      ^~~~~
4 errors.
```

Compile to machine code, then run the bytes on their own:

```
$ turtlec examples/square.turtle --bin square.tvm --svg square.svg --phase gen

6  Code generation                              8 instructions, 32 bytes
------------------------------------------------------------------------
  0000  20 00 00 05  COL  #BLUE        ; color BLUE
  0001  30 01 00 04  LDI  R1, #4       ; t1 = 4
  0002  40 01 00 07  JLE  R1, 0007     ; if t1 <= 0 goto L2
  0003  10 00 00 64  FWD  #100         ; move 100
  0004  11 00 00 5A  RGT  #90          ; turn 90
  0005  31 01 00 00  DEC  R1           ; t1 = t1 - 1
  0006  41 00 00 02  JMP  0002         ; goto L1
  0007  FF 00 00 00  HLT               ; halt

  Labels
    L1    0002
    L2    0007

  Loop registers
    t1    R1  REPEAT on line 3

  Opcodes  FWD 10  RGT 11  LFT 12  COL 20  PUP 21  PDN 22  LDI 30  DEC 31  JLE 40  JMP 41  HLT FF

$ turtlec run square.tvm
turtlec 0.1.0  square.tvm  (8 instructions)

Run                                                             24 steps
------------------------------------------------------------------------
  Steps           24
  Lines drawn     4
  Final position  x 0, y 0
  Heading         0°
  Pen             down, BLUE
```

## The .tvm format

Each instruction is 4 bytes: opcode, register, then a 16-bit big-endian operand. The opcodes are `TC.OPCODES` in `compiler/compiler.js`. For `COL` the operand is the index into `TC.COLOR_NAMES`. `turtlec run` checks that the length is a multiple of 4 and that every opcode, register, colour and jump target is valid before it runs anything.

## Tests

```
node --test cli/test
```
