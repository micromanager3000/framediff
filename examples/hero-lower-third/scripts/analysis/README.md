# EDL / grade / transform recovery pipeline

The scripts that recovered the hero cut from the raw footage, in run order (python3 + numpy + ffmpeg;
paths to the reference render + footage folder are constants at the top of each):

1. `extract.py` — sample target + all raw clips to normalized grayscale arrays
2. `match.py` — coarse NCC: which clip is on screen at every reference frame
3. `refine.py` / `refine2.py` — per-segment alignment: exact source offsets, speeds, score curves
4. `boundaries.py` — cut boundaries via score crossover + (raw, reference) color pairs for the LUT fit
5. `pairs2.py` — regenerate `pairs.npz` from the current AEP-exact mapping when grade fitting
   needs fresh source/target pairs
6. `gradefit.py` — fit the 33³ .cube LUTs from the pairs → public/luts/
7. `cornerfit.py` — corner-pin quads for the AE 3D-camera shots
8. `compare.py` / `finalreport.py` — probe-frame diffs and the full-render SSIM report

Numbers land in `src/data/heroEdl.ts` and feed the generated `HeroRaw` HTML in
`src/compositions/HeroRaw.ts`;
regenerate rather than hand-tune.
