# gradefit report

Method: per-pair scale+translation alignment (coarse-to-fine gray
NCC: level-4 scan s in [0.8,1.6] step .04 / +-40 px, level-2 and
full-res refine), 9x9 local-NCC masking (keep NCC>=0.6 structured
or mutually-flat windows; drops caption/overlay pixels), robust
affine pre-fit with outlier trimming, then 17^3 median-bin lattice
with screened-diffusion fill (init = affine extrapolation),
upsampled to 33^3 .cube (R fastest, domain [0,1]).

Global LUT fitted on all normal (rec709) segments (1996 bins filled,
7970525 samples). FX3 LUT fitted on 'open'; 'phone' shares it.

FX3 smoothing: median-bin LUT blended 65% toward a robust affine fit
(293 bins, 2149559 samples, 98.0% affine inliers), with a near-black identity ramp.

| segment | pairs | PSNR identity | PSNR global | PSNR own-fit | chosen |
|---|---|---|---|---|---|
| blazer | 6 | 26.62 | 35.61 | 36.75 | global.cube |
| desk | 6 | 27.00 | 31.56 | 31.54 | global.cube |
| greentrack | 6 | 23.41 | 24.32 | 24.38 | global.cube |
| greenwide | 6 | 23.48 | 24.45 | 24.52 | global.cube |
| grid | 6 | 19.50 | 19.99 | 24.60 | grid.cube |
| hf_talk | 6 | 26.74 | 35.17 | 37.67 | hf_talk.cube |
| keynote_a | 6 | 25.53 | 26.49 | 26.48 | global.cube |
| keynote_b | 6 | 26.18 | 26.96 | 27.55 | global.cube |
| magnific | 6 | 25.04 | 28.83 | 29.29 | global.cube |
| news_a | 6 | 25.73 | 28.58 | 28.59 | global.cube |
| news_b | 6 | 25.04 | 26.95 | 27.00 | global.cube |
| news_c | 6 | 30.13 | 34.56 | 34.95 | global.cube |
| open | 11 | 26.53 | 25.62 | 33.52 | fx3.cube |
| phone | 11 | 25.66 | 23.73 | 32.64 | fx3.cube |
| smartest | 6 | 25.29 | 26.32 | 26.30 | global.cube |
| tripod | 6 | 24.24 | 24.97 | 25.39 | global.cube |
| uizoom | 6 | 19.05 | 19.58 | 19.99 | global.cube |

## Alignment (per pair)

| # | seg | scale | ty | tx | NCC |
|---|---|---|---|---|---|
| 0 | open | 1.070 | -8.0 | -5.0 | 0.987 |
| 1 | open | 1.080 | -9.0 | -6.0 | 0.986 |
| 2 | open | 1.100 | -10.0 | -5.0 | 0.975 |
| 3 | open | 1.110 | -11.0 | -7.0 | 0.983 |
| 4 | open | 1.140 | -13.0 | -8.0 | 0.983 |
| 5 | open | 1.140 | -14.0 | -9.0 | 0.986 |
| 6 | open | 1.150 | -15.0 | -10.0 | 0.987 |
| 7 | open | 1.180 | -18.0 | -11.0 | 0.984 |
| 8 | open | 1.180 | -18.0 | -11.0 | 0.985 |
| 9 | open | 1.210 | -20.0 | -12.0 | 0.985 |
| 10 | open | 1.190 | -42.0 | 50.0 | 0.388 |
| 11 | phone | 1.000 | -2.0 | 0.0 | 0.992 |
| 12 | phone | 1.010 | -1.0 | 1.0 | 0.992 |
| 13 | phone | 1.000 | -1.0 | 0.0 | 0.993 |
| 14 | phone | 1.000 | -1.0 | 1.0 | 0.993 |
| 15 | phone | 1.000 | -2.0 | 1.0 | 0.994 |
| 16 | phone | 1.000 | -2.0 | 0.0 | 0.992 |
| 17 | phone | 1.000 | -2.0 | 1.0 | 0.992 |
| 18 | phone | 1.000 | -2.0 | 0.0 | 0.986 |
| 19 | phone | 1.000 | 0.0 | 2.0 | 0.976 |
| 20 | phone | 1.000 | 0.0 | 1.0 | 0.973 |
| 21 | phone | 1.000 | -1.0 | 1.0 | 0.947 |
| 22 | grid | 1.450 | 32.0 | 26.0 | 0.314 |
| 23 | grid | 1.010 | 0.0 | 0.0 | 0.702 |
| 24 | grid | 1.010 | 0.0 | 0.0 | 0.925 |
| 25 | grid | 1.020 | 0.0 | 0.0 | 0.937 |
| 26 | grid | 1.030 | 0.0 | 0.0 | 0.938 |
| 27 | grid | 1.030 | 0.0 | 0.0 | 0.932 |
| 28 | news_a | 1.020 | 0.0 | 0.0 | 0.984 |
| 29 | news_a | 1.000 | 1.0 | 0.0 | 0.999 |
| 30 | news_a | 1.000 | 1.0 | 0.0 | 0.945 |
| 31 | news_a | 1.000 | 1.0 | 0.0 | 0.946 |
| 32 | news_a | 1.000 | 1.0 | 0.0 | 0.947 |
| 33 | news_a | 1.000 | 1.0 | 0.0 | 0.943 |
| 34 | news_b | 1.000 | 1.0 | 0.0 | 0.975 |
| 35 | news_b | 1.000 | 1.0 | 0.0 | 0.975 |
| 36 | news_b | 1.000 | 1.0 | 0.0 | 0.975 |
| 37 | news_b | 1.000 | 1.0 | 0.0 | 0.975 |
| 38 | news_b | 1.000 | 1.0 | 0.0 | 0.975 |
| 39 | news_b | 1.010 | 1.0 | 0.0 | 0.889 |
| 40 | news_c | 1.000 | 1.0 | 0.0 | 0.966 |
| 41 | news_c | 1.000 | 1.0 | 0.0 | 0.966 |
| 42 | news_c | 1.000 | 1.0 | 0.0 | 0.966 |
| 43 | news_c | 1.000 | 1.0 | 0.0 | 0.966 |
| 44 | news_c | 1.000 | 1.0 | 0.0 | 0.967 |
| 45 | news_c | 1.000 | 1.0 | 0.0 | 0.999 |
| 46 | uizoom | 0.990 | 0.0 | 0.0 | 0.748 |
| 47 | uizoom | 0.990 | 0.0 | 0.0 | 0.748 |
| 48 | uizoom | 0.990 | 0.0 | 0.0 | 0.747 |
| 49 | uizoom | 0.990 | 0.0 | 0.0 | 0.746 |
| 50 | uizoom | 0.990 | 0.0 | 0.0 | 0.744 |
| 51 | uizoom | 0.990 | 0.0 | 0.0 | 0.742 |
| 52 | keynote_a | 0.970 | 44.0 | -54.0 | 0.169 |
| 53 | keynote_a | 0.990 | 2.0 | 3.0 | 0.840 |
| 54 | keynote_a | 1.000 | 1.0 | 1.0 | 0.938 |
| 55 | keynote_a | 1.000 | 1.0 | 0.0 | 0.980 |
| 56 | keynote_a | 1.000 | 1.0 | 0.0 | 0.979 |
| 57 | keynote_a | 1.000 | 1.0 | 0.0 | 0.979 |
| 58 | hf_talk | 1.020 | 0.0 | 0.0 | 0.998 |
| 59 | hf_talk | 1.020 | 0.0 | 0.0 | 0.998 |
| 60 | hf_talk | 1.020 | 0.0 | 0.0 | 0.998 |
| 61 | hf_talk | 1.020 | 0.0 | 0.0 | 0.998 |
| 62 | hf_talk | 1.020 | 0.0 | 0.0 | 0.998 |
| 63 | hf_talk | 1.530 | 36.0 | 26.0 | 0.319 |
| 64 | magnific | 1.030 | 0.0 | 0.0 | 0.971 |
| 65 | magnific | 1.040 | 0.0 | 0.0 | 0.992 |
| 66 | magnific | 1.050 | 0.0 | 0.0 | 0.973 |
| 67 | magnific | 1.050 | 0.0 | 0.0 | 0.983 |
| 68 | magnific | 1.060 | 0.0 | 0.0 | 0.993 |
| 69 | magnific | 1.280 | -25.0 | -24.0 | 0.217 |
| 70 | greenwide | 1.100 | -8.0 | -14.0 | 0.969 |
| 71 | greenwide | 1.100 | -8.0 | -14.0 | 0.973 |
| 72 | greenwide | 1.090 | -8.0 | -15.0 | 0.948 |
| 73 | greenwide | 1.100 | -8.0 | -14.0 | 0.973 |
| 74 | greenwide | 1.100 | -8.0 | -15.0 | 0.975 |
| 75 | greenwide | 1.580 | 22.0 | 54.0 | 0.428 |
| 76 | greentrack | 1.600 | 22.0 | 54.0 | 0.428 |
| 77 | greentrack | 1.100 | -8.0 | -15.0 | 0.984 |
| 78 | greentrack | 1.100 | -9.0 | -16.0 | 0.986 |
| 79 | greentrack | 1.100 | -9.0 | -15.0 | 0.991 |
| 80 | greentrack | 1.100 | -10.0 | -14.0 | 0.991 |
| 81 | greentrack | 0.930 | 6.0 | -16.0 | 0.216 |
| 82 | desk | 1.010 | 0.0 | 0.0 | 0.997 |
| 83 | desk | 1.010 | 0.0 | 0.0 | 0.987 |
| 84 | desk | 1.020 | 0.0 | 0.0 | 0.994 |
| 85 | desk | 1.020 | 0.0 | 0.0 | 0.989 |
| 86 | desk | 1.030 | 0.0 | 0.0 | 0.996 |
| 87 | desk | 0.970 | 0.0 | 54.0 | 0.096 |
| 88 | smartest | 1.000 | 2.0 | 0.0 | 0.977 |
| 89 | smartest | 1.010 | 2.0 | 0.0 | 0.990 |
| 90 | smartest | 1.020 | 3.0 | 0.0 | 0.990 |
| 91 | smartest | 1.020 | 4.0 | 0.0 | 0.977 |
| 92 | smartest | 1.030 | 5.0 | 0.0 | 0.987 |
| 93 | smartest | 1.610 | 22.0 | -7.0 | 0.270 |
| 94 | blazer | 1.080 | -9.0 | -14.0 | 0.998 |
| 95 | blazer | 1.080 | -9.0 | -14.0 | 0.998 |
| 96 | blazer | 1.080 | -9.0 | -14.0 | 0.998 |
| 97 | blazer | 1.080 | -9.0 | -14.0 | 0.998 |
| 98 | blazer | 1.080 | -9.0 | -14.0 | 0.999 |
| 99 | blazer | 0.780 | -54.0 | 54.0 | -0.082 |
| 100 | tripod | 1.000 | 0.0 | 0.0 | 0.986 |
| 101 | tripod | 1.010 | 0.0 | 0.0 | 0.988 |
| 102 | tripod | 1.020 | 1.0 | 1.0 | 0.988 |
| 103 | tripod | 1.020 | 1.0 | 1.0 | 0.979 |
| 104 | tripod | 1.040 | 1.0 | 1.0 | 0.979 |
| 105 | tripod | 1.590 | 30.0 | 10.0 | 0.477 |
| 106 | keynote_b | 1.030 | 2.0 | 2.0 | 0.985 |
| 107 | keynote_b | 1.020 | 1.0 | 1.0 | 0.990 |
| 108 | keynote_b | 1.030 | 1.0 | 1.0 | 0.982 |
| 109 | keynote_b | 1.050 | 1.0 | 2.0 | 0.948 |
| 110 | keynote_b | 1.020 | 1.0 | 0.0 | 0.975 |
| 111 | keynote_b | 1.440 | -34.0 | 30.0 | 0.068 |

Excluded pairs (NCC<0.40 or too few valid px): 10(open), 22(grid), 52(keynote_a), 63(hf_talk), 69(magnific), 81(greentrack), 87(desk), 93(smartest), 99(blazer), 111(keynote_b)

PSNR is computed on aligned, NCC-masked pixels (fair for
color-only comparison; unmasked full-frame PSNR would be
dominated by spatial mismatch and overlay text).
