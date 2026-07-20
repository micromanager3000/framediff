// Raw LightTwist footage imported into framediff.assets.json. These are the only media sources
// used by the raw hero rebuild; the reference render is reserved for comparison.

export const RAW_ASSETS = {
  open: "asset://c564314e-6dd9-417f-bc06-6a8110964a80",
  phone: "asset://3e449888-0514-4079-b9c4-b3e2db9e5036",
  grid: "asset://cf3cdc78-3fe4-464a-bcc9-e05c2e24cdad",
  news: "asset://f753f5f7-6248-421f-a1c9-521038083aaf",
  uiZoom: "asset://e24bd202-2f43-4068-a8a6-e01c6a211afa",
  june3d: "asset://b1a7edc8-b272-446d-b008-8f357d3dae74",
  splitLeft: "asset://a7593343-316b-4105-a02e-fe56da2590c7",
  splitRight: "asset://2d1c65c2-e291-4a54-9ba1-baebba370975",
  interfaceDemo: "asset://1f7ea0b8-1d9e-4973-98fa-526fde09e1a2",
  keynoteA: "asset://a133b071-aaab-4e52-a27e-d17b68001c94",
  hfTalk: "asset://3c5d912b-6657-4fd9-8480-cf4e8602c768",
  magnific: "asset://1ccc7e58-8391-49ee-b6e5-b02c68e1b337",
  greenwide: "asset://666ee08a-03b2-4249-a48f-646e87559269",
  desk: "asset://24bd8424-47b6-470e-98ac-0920cb2e3421",
  smartest: "asset://d56f429f-3ab7-452f-bc9a-d0c2b51b5a77",
  blazer: "asset://5588595d-f8e1-40f0-9f54-611b50d4ff82",
  tripod: "asset://3b0601e4-5906-49f5-9d39-4b98533c056f",
  keynoteB: "asset://50ff4736-f5a8-4667-88f9-ae99551eff0e",
  flare: "asset://68deb1f4-c321-4c2d-a14c-362cf75343d1",
  audioBed: "asset://c50127ee-3950-4bbe-a6f4-30ffc1bdc4a5",
  shine: "asset://00b05305-98d7-430a-9e64-985be275837b",
  logoReveal: "asset://9e4a53f5-3007-4cdd-8f49-992db4ebc9d1",
} as const;

// Browser-safe H.264/YUV420 proxies generated only from the raw footage by scripts/make-proxies.sh.
// These are what the example renders with; the raw originals above remain imported for provenance.
export const RAW_PROXY_ASSETS = {
  open: "asset://proxy-open",
  phone: "asset://proxy-phone",
  grid: "asset://proxy-grid",
  news: "asset://proxy-news",
  uiZoom: "asset://proxy-uizoom",
  june3d: "asset://proxy-june3d",
  splitLeft: "asset://proxy-split-l",
  splitRight: "asset://proxy-split-r",
  cam4: "asset://proxy-cam4",
  cam6: "asset://proxy-cam6",
  keynoteA: "asset://proxy-keynote-a",
  hfTalk: "asset://proxy-hf-talk",
  magnific: "asset://proxy-magnific",
  greenwide: "asset://proxy-greenwide",
  desk: "asset://proxy-desk",
  smartest: "asset://proxy-smartest",
  blazer: "asset://proxy-blazer",
  tripod: "asset://proxy-tripod",
  keynoteB: "asset://proxy-keynote-b",
  flare: "asset://proxy-flare",
} as const;
