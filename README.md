[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/mochhidayah/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/mochhidayah/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader-speed-01-run-20261121

Faster drop-in for csv-reader 1.0.0 — identical answers, less CPU, built for make.fun.

## What it does

`run(input)` reads `{text, header}` exactly the way csv-reader 1.0.0 does
and returns `{columns, rows, errors}`: the header (or `null`), every other
record as an array of strings at the first record's width, and every broken
thing met, in the order met. Broken rows are read by csv-reader's own policy
— BOM dropped, stray CRs dropped with an error, quoted fields with `""` and
line breaks inside them, junk after a closing quote, a quote that never
closes read again as unquoted, short rows padded and long rows cut.

## Why it is faster

The reference reads one character at a time and builds every field up a
character at a time. This one is an index-driven scanner:

- Records with no quote take a fast path: one slice of the line, one
  `split(",")`, no per-character work at all.
- An unquoted field ends at the nearest comma or LF, found with native
  `indexOf`; stray CRs are found on the field's slice and dropped at once.
- A quoted field is found with `indexOf`, its content taken with one slice
  and transformed only when it holds `""` or a CR; line breaks inside it
  are counted with native `indexOf`, never a character loop.
- No search ever runs past the line or field it works on.

On the practice set (6 cases, ~10.2 MB of CSV) `run()` takes ~110 ms
against the reference's ~460 ms — about 4.1x faster — and the whole
program, input JSON in and answers JSON out, runs in ~750 ms against the
reference's ~1440 ms. Every answer is byte-identical to csv-reader 1.0.0's
on all 6 practice cases, on 118 handcrafted broken cases, and on 12,000
randomly fuzzed broken inputs.

## Layout

- `solve.js` — the parser, a dependency-free ES module exporting `run(input)`.
- `main.ts` — the program the harness runs: reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`.

## Run it

```sh
node main.ts
```

Outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in
for `/input` and `/output`. Node 22 or later, nothing to install.

## License

MIT — see [LICENSE](LICENSE).
